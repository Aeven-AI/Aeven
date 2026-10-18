# Agent Note：桌面应用自带 ffmpeg

Status: implemented

[English](2026-10-18-desktop-bundles-ffmpeg.md) | 中文

## 问题

视频与音频对 Aeven 是不透明的。`packages/attachment/attachment-local` 通过 sharp 归一化并测量图片，完全没有视频路径，因此视频附件到达时既没有时长、尺寸，也没有封面帧。WhatsApp 守护进程是唯一已经需要转换器的消费者，它调用 `PATH` 上碰巧存在的 `ffmpeg`（`native/whatsapp-mcp/source/internal/media/audio.go`），所以在任何没有系统安装的机器上，语音消息都会失败。

## 决定

`native/ffmpeg` 持有该可执行文件，与 `native/whisper-cpp`、`native/whatsapp-mcp` 并列。`source.json` 固定上游 9.0.2 发行包及其 SHA-256；`scripts/build.ts` 校验该归档，按目标做树外构建，剥离符号后放进 `packages/<platform>-<arch>/bin`。六个平台包沿用 WhatsApp 守护进程的布局，`@aeven/account-integrations` 把它们声明为可选依赖，解析出与本机匹配的那一个，并把其目录前插到 WhatsApp 守护进程的 `PATH`，使守护进程里的 `exec.LookPath("ffmpeg")` 找到自带副本而不是系统副本。

构建只使用 LGPL：`--disable-gpl --disable-nonfree --disable-version3 --disable-autodetect`，外部库只有 zlib 与 libopus，两者都是宽松许可。libopus 在 macOS 与 Linux 上由自身固定的源码静态编译，在 Windows 上取自工具链自带的静态包，因此该可执行文件不依赖任何系统或 Homebrew 库。H.264 导出走平台编码器——macOS 用 VideoToolbox，Linux 用 VAAPI——而不是 libx264。`--disable-network` 与 `--disable-avdevice` 把远程协议与采集设备排除在这个只读本地文件的二进制之外，`--disable-programs --enable-ffmpeg` 只构建命令行程序。

ffprobe 有意不随附：它静态链接同一批库，几乎会让体积翻倍，而它要读的时长信息 ffmpeg 自身的 `-i` 输出已经包含。

选择从源码构建而不是固定预编译的 LGPL 静态二进制，是体积上的决定。可维护的预编译产物带着自动探测到的完整依赖：BtbN 的 LGPL Windows 与 Linux 可执行文件为 76.9–135.9 MB，pproenca 的 LGPL macOS 可执行文件为 33.7–46.0 MB；而这条 configure 在 darwin-arm64 上产出 21.0 MB，压后 9.9 MB，且带有 Aeven 需要的编码器。

Windows 沿用 MSYS2 自家 ffmpeg 的做法：`--target-os=mingw32`、`--arch` 与显式 `--cc`，不使用 cross prefix，因为 cross prefix 会让 configure 去找带前缀的 `pkg-config`，找不到时直接禁用 pkg-config。macOS 在打包前通过 `signMacOSPackageExecutables` 签名该可执行文件，与 whisper worker 和 WhatsApp 守护进程走的是同一步。Windows Media Foundation 保持关闭：它对 MFPlat 的静态依赖会让 `ffmpeg.exe` 在 Windows N 版上无法启动，而封面帧与音频并不需要它。

## 考虑过的替代方案

**像 whisper 模型那样首次使用时下载。** 那些模型是本地语音中唯一下载的部分，worker 本身随包发布。封面帧与探测在渲染时运行，会和首次下载抢时间；而让下载变得可靠的共享 artifact-cache 接缝，应该等到出现第二个下载资产时再做。

**随附第三方预编译二进制。** 接线更省事，但每个可维护的 LGPL 选项都大 1.6–6.5 倍，没有任何单一项目覆盖全部六个目标，构建参数也就变成别人的决定。

**向模型暴露通用的“用这些参数运行 ffmpeg”工具。** 推迟：它把不受限的 CPU 和文件系统触达交给模型，需要单独的沙箱。

## 影响

macOS 上每个安装包增加约 21 MB 安装体积、10 MB 压缩体积；Linux 与 Windows 目标在各自 runner 构建时测量。新增编码器意味着修改 configure 行并重建全部六个目标。目标 runner 需要 zlib 开发包、pkg-config，以及 x86_64 汇编内核所需的 nasm；Windows 构建经由 MSYS2 bash，因为 `configure` 是 POSIX 脚本，其 mingw64 与 clangarm64 工具链提供编译器、binutils 与静态 libopus。没有 nasm 时构建仍会成功，只是给出解码速度警告。LGPL 义务与任何随附的 LGPL 可执行文件相同：随附许可文本、写明 configure 行、并提供对应源码，`source.json` 正是精确固定的那一份。
