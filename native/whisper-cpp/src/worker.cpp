// Private speech recognition worker over whisper.cpp: loads one Whisper model, checks one Silero VAD model,
// then transcribes framed PCM recordings from stdin until stdin closes.
//
// Wire contract (README.md#worker-protocol): stdout carries only newline-delimited JSON — one
// `{"ready":true}` line after both models load, then exactly one result line per request. Each
// request is the 4-byte magic "AVW1", a little-endian uint32 language byte length, a little-endian
// uint32 sample count, the ASCII language hint, then the 16 kHz mono PCM16 little-endian samples.
// Library diagnostics go to stderr. The worker opens no socket; it reads only the two model files named
// by its arguments (whisper.cpp reopens the VAD model for each request).

#include "whisper.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

struct Options {
    std::string model;
    std::string vad_model;
    int threads = 4;
    uint32_t max_samples = 16000 * 120;
    whisper_vad_params vad = whisper_vad_default_params();
};

[[noreturn]] void usage(const char * detail) {
    std::fprintf(stderr, "avn-whisper-worker: %s\n", detail);
    std::exit(2);
}

long parse_int(const char * value, const char * name, long min, long max) {
    char * end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (end == value || *end != '\0' || parsed < min || parsed > max) usage(name);
    return parsed;
}

float parse_float(const char * value, const char * name, float min, float max) {
    char * end = nullptr;
    const float parsed = std::strtof(value, &end);
    if (end == value || *end != '\0' || !(parsed >= min && parsed <= max)) usage(name);
    return parsed;
}

Options parse_options(int argc, char ** argv) {
    Options options;
    for (int i = 1; i < argc; i++) {
        const std::string flag = argv[i];
        if (i + 1 >= argc) usage(("missing value for " + flag).c_str());
        const char * value = argv[++i];
        if (flag == "--model") options.model = value;
        else if (flag == "--vad-model") options.vad_model = value;
        else if (flag == "--threads") options.threads = static_cast<int>(parse_int(value, "invalid --threads", 1, 256));
        else if (flag == "--max-samples") options.max_samples = static_cast<uint32_t>(parse_int(value, "invalid --max-samples", 1, 16000L * 3600));
        else if (flag == "--vad-threshold") options.vad.threshold = parse_float(value, "invalid --vad-threshold", 0.0f, 1.0f);
        else if (flag == "--vad-min-speech-ms") options.vad.min_speech_duration_ms = static_cast<int>(parse_int(value, "invalid --vad-min-speech-ms", 0, 600000));
        else if (flag == "--vad-min-silence-ms") options.vad.min_silence_duration_ms = static_cast<int>(parse_int(value, "invalid --vad-min-silence-ms", 0, 600000));
        else if (flag == "--vad-max-speech-s") options.vad.max_speech_duration_s = parse_float(value, "invalid --vad-max-speech-s", 1.0f, 3600.0f);
        else if (flag == "--vad-pad-ms") options.vad.speech_pad_ms = static_cast<int>(parse_int(value, "invalid --vad-pad-ms", 0, 10000));
        else usage(("unknown option " + flag).c_str());
    }
    if (options.model.empty() || options.vad_model.empty()) usage("--model and --vad-model are required");
    return options;
}

void log_to_stderr(enum ggml_log_level, const char * text, void *) {
    std::fputs(text, stderr);
}

bool read_exact(void * destination, size_t bytes) {
    return bytes == 0 || std::fread(destination, 1, bytes, stdin) == bytes;
}

uint32_t little_endian_u32(const unsigned char * bytes) {
    return static_cast<uint32_t>(bytes[0]) | static_cast<uint32_t>(bytes[1]) << 8
        | static_cast<uint32_t>(bytes[2]) << 16 | static_cast<uint32_t>(bytes[3]) << 24;
}

// JSON string escaping; the recognizer emits UTF-8, which passes through unchanged.
std::string json_string(const std::string & text) {
    std::string out = "\"";
    for (const unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char escaped[7];
                    std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
                    out += escaped;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out + "\"";
}

void reply(const std::string & line) {
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}

void reply_error(const char * code, const std::string & message) {
    reply(std::string("{\"error\":") + json_string(message) + ",\"code\":" + json_string(code) + "}");
}

std::string trim(const std::string & text) {
    const size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    return text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
}

// Greedy decoding at temperature 0 without fallback, and no conditioning on earlier text: dictation favors
// deterministic, fast single-pass output over re-decoding hard audio.
whisper_full_params decoding_params(const Options & options) {
    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = options.threads;
    params.temperature = 0.0f;
    params.temperature_inc = 0.0f;
    params.no_context = true;
    params.no_timestamps = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_special = false;
    params.print_timestamps = false;
    params.suppress_nst = true;
    return params;
}

} // namespace

int main(int argc, char ** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    const Options options = parse_options(argc, argv);
    whisper_log_set(log_to_stderr, nullptr);

    whisper_context_params context_params = whisper_context_default_params();
    context_params.use_gpu = true;
    whisper_context * context = whisper_init_from_file_with_params(options.model.c_str(), context_params);
    if (context == nullptr) {
        std::fprintf(stderr, "avn-whisper-worker: failed to load model %s\n", options.model.c_str());
        return 3;
    }
    whisper_vad_context * vad = whisper_vad_init_from_file_with_params(options.vad_model.c_str(), whisper_vad_default_context_params());
    if (vad == nullptr) {
        std::fprintf(stderr, "avn-whisper-worker: failed to load VAD model %s\n", options.vad_model.c_str());
        whisper_free(context);
        return 3;
    }
    whisper_vad_free(vad);
    // One second of silence decoded without VAD allocates compute buffers, so the first recording is not slower.
    const std::vector<float> warmup(16000, 0.0f);
    whisper_full_params warmup_params = decoding_params(options);
    warmup_params.language = "en";
    if (whisper_full(context, warmup_params, warmup.data(), static_cast<int>(warmup.size())) != 0) {
        std::fprintf(stderr, "avn-whisper-worker: warm-up inference failed\n");
        whisper_free(context);
        return 3;
    }
    reply("{\"ready\":true}");

    std::vector<int16_t> pcm;
    std::vector<float> samples;
    for (;;) {
        unsigned char header[12];
        if (!read_exact(header, sizeof header)) break;
        if (std::memcmp(header, "AVW1", 4) != 0) {
            std::fprintf(stderr, "avn-whisper-worker: invalid request frame\n");
            whisper_free(context);
            return 4;
        }
        const uint32_t language_bytes = little_endian_u32(header + 4);
        const uint32_t sample_count = little_endian_u32(header + 8);
        if (language_bytes == 0 || language_bytes > 16 || sample_count > options.max_samples) {
            std::fprintf(stderr, "avn-whisper-worker: request exceeds its bounds\n");
            whisper_free(context);
            return 4;
        }
        std::string language(language_bytes, '\0');
        pcm.resize(sample_count);
        if (!read_exact(language.data(), language_bytes) || !read_exact(pcm.data(), pcm.size() * sizeof(int16_t))) {
            std::fprintf(stderr, "avn-whisper-worker: truncated request\n");
            whisper_free(context);
            return 4;
        }
        if (language != "auto" && whisper_lang_id(language.c_str()) < 0) {
            reply_error("invalid-input", "Unsupported Whisper language: " + language);
            continue;
        }
        samples.resize(sample_count);
        for (uint32_t i = 0; i < sample_count; i++) {
            const unsigned char * bytes = reinterpret_cast<const unsigned char *>(&pcm[i]);
            const int16_t value = static_cast<int16_t>(static_cast<uint16_t>(bytes[0]) | static_cast<uint16_t>(bytes[1]) << 8);
            samples[i] = static_cast<float>(value) / 32768.0f;
        }

        whisper_full_params params = decoding_params(options);
        params.language = language.c_str();
        params.vad = true;
        params.vad_model_path = options.vad_model.c_str();
        params.vad_params = options.vad;

        const auto started = std::chrono::steady_clock::now();
        if (whisper_full(context, params, samples.data(), static_cast<int>(samples.size())) != 0) {
            reply_error("inference", "Whisper inference failed");
            continue;
        }
        std::string text;
        const int segments = whisper_full_n_segments(context);
        for (int i = 0; i < segments; i++) text += whisper_full_get_segment_text(context, i);
        const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        char metrics[64];
        std::snprintf(metrics, sizeof metrics, ",\"inferenceSeconds\":%.6f}", seconds);
        reply("{\"text\":" + json_string(trim(text)) + metrics);
    }
    whisper_free(context);
    return 0;
}
