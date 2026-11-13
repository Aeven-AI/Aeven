---
description: "右侧栏的录音机：把会议从麦克风和电脑音频中转录下来，标注说话人，并保存录音。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-meeting

[English](README.md) | 中文

## 概述

录音机标签页在读者自己的电脑上录制会议：麦克风作为“你”，使用 Chromium 的系统级回声消除；电脑音频作为其他人——桌面外壳会以系统回环音频响应仅含音频的 `getDisplayMedia`，支持 macOS、Windows 与 Linux。每个来源被切分为包含几句话的语段，并像听写转录一整段录音那样，经 speech Remote 整段转录。宿主的说话人分离就绪时，Whisper 的每个带时间的句子归属于说出其大部分内容的声音，同一场会议中的声音依次编号为发言人 1、发言人 2 等。以已转录语音结束的录音会连同音频经 speech Remote 保存；窗格在弹窗中列出、播放、复制、添加到聊天并删除已保存的录音。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在桌面 Web 客户端中编排本插件。它需要 `sidebarContent`、`remote` 与 `remote.speech`，并在插件 fiber 的 effect 中注册 `meeting` 窗格、其字典，以及一个停止录制的关闭处理器。所有窗格共用一个录音器，因此录制会跨会话继续。说话人分离尚未准备时，打开窗格会调用 `speech.prepareDiarization`，进度条跟随 `speech.followDiarization`。录音器使用读者选择的语音提供方转录；在自动语言检测下，它会确定会议大部分语音所用的语言，并用该语言解码其余内容，包括之前被检测为其他语言的语句。“添加到聊天”会把转录追加到窗格所属会话的输入框。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [api-speech-to-text](../../speech/api-speech-to-text/README.zh.md) —— 录音机用于转录、说话人分离与保存的 Remote。
- [speaker-diarization](../../speech/speaker-diarization/README.zh.md) 与 [recordings](../../speech/recordings/README.zh.md) —— 这些调用背后的宿主服务。
- [ui-sidebar-select](../ui-sidebar-select/README.zh.md) —— 本窗格注册到的内容注册表。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经由对话输入框的草稿：录音机添加到聊天的转录会成为模型读取的用户消息，因此只有在用户提交后，会议内容才会进入请求。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求，它插入的转录是普通的用户消息文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **无不变式伴生入口** —— 不发布不变式伴生入口，因为录音器是它所显示录音的唯一所有者：每个窗格都呈现这一个录音器的快照，客户端不保留第二份可与该状态相互比较的副本。
- **仅限桌面** —— 托管包会停用该窗格，其侧栏入口改为显示桌面应用的转交对话框；录音音频经文件同步在账户的桌面设备之间传输，而托管宿主不运行文件同步。
- **系统音频是整台电脑的声音** —— 回环会捕获电脑播放的所有声音（Aeven 自身除外），而不只是会议应用。
- **简短插话可能归到错误的说话人** —— 短于四秒的片段会并入最接近的已知声音，而不是建立新的声音。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 —— 点击展开</summary>

采集 worklet 在把每个来源重采样到 16 kHz 之前，先在 7.2 kHz 做低通滤波：没有它时，混叠会让不同说话人的声纹看起来相似，整场会议被合并成一个说话人。

</details>
