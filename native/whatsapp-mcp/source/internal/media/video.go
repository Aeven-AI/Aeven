package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
)

// ConvertGIFToMP4 shells out to ffmpeg to turn a GIF into the H.264 MP4
// WhatsApp plays as a looping GIF: WhatsApp has no animated-image message,
// and its own clients convert a GIF the same way before sending it as a
// video with gifPlayback set. Odd dimensions are rounded down to even, which
// yuv420p requires. Returns a temp file path the caller removes.
func ConvertGIFToMP4(ctx context.Context, inputPath string) (outputPath string, err error) {
	if _, lookErr := exec.LookPath("ffmpeg"); lookErr != nil {
		return "", errors.New("ffmpeg not found on PATH; install ffmpeg to send GIFs, or send an MP4 instead")
	}
	tmp, err := os.CreateTemp("", "mcp-whatsapp-gif-*.mp4")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("failed to close temp file: %w", err)
	}
	encoder, err := h264Encoder(ctx)
	if err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	args := []string{
		"-i", sanitizeFFmpegInputPath(inputPath),
		"-movflags", "+faststart",
		"-pix_fmt", "yuv420p",
		"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
		"-c:v", encoder,
	}
	if encoder != "libx264" {
		// The platform encoders have no quality default fit for a short loop.
		args = append(args, "-b:v", "2M")
	}
	args = append(args, "-an", "-y", tmpPath)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Env = minimalEnv()
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("ffmpeg GIF conversion failed: %w: %s", err, sanitizeStderr(stderr.String()))
	}
	return tmpPath, nil
}

// h264Encoders are the H.264 encoders WhatsApp's MP4 can come from, in order
// of preference: x264 where the build carries it (the Linux host's ffmpeg),
// then the platform encoders a bundled LGPL build carries instead
// (VideoToolbox on macOS, Media Foundation on Windows), then OpenH264.
var h264Encoders = []string{"libx264", "h264_videotoolbox", "h264_mf", "libopenh264"}

// h264Encoder names the first H.264 encoder this ffmpeg build offers.
func h264Encoder(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-encoders")
	cmd.Env = minimalEnv()
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("listing ffmpeg encoders failed: %w", err)
	}
	for _, encoder := range h264Encoders {
		if bytes.Contains(out, []byte(" "+encoder+" ")) {
			return encoder, nil
		}
	}
	return "", errors.New("this ffmpeg build has no H.264 encoder, so a GIF cannot be sent; send an MP4 instead")
}

// VideoStillJPEG returns one representative frame of a video as a JPEG at
// most 640 pixels wide, so a reader that takes images but not video can see
// what a GIF or clip shows. ffmpeg's thumbnail filter picks the frame most
// like the others among the first frames, which skips a blank first frame.
func VideoStillJPEG(ctx context.Context, path string) ([]byte, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("ffmpeg not found on PATH")
	}
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-i", sanitizeFFmpegInputPath(path),
		"-vf", "thumbnail,scale='min(640,iw)':-2",
		"-frames:v", "1",
		"-f", "image2",
		"-c:v", "mjpeg",
		"pipe:1",
	)
	cmd.Env = minimalEnv()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg still frame failed: %w: %s", err, sanitizeStderr(stderr.String()))
	}
	if stdout.Len() == 0 {
		return nil, errors.New("ffmpeg produced no frame")
	}
	return stdout.Bytes(), nil
}
