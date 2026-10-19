# Agent Note：composer 的增补菜单可以直接拍摄

Status: implemented

[English](2026-10-18-composer-camera-capture.md) | 中文

## Problem

增补菜单提供了 File、Goal、Plan 和 Feedback，却没有一项用上读者面前的设备。一张截图、一块白板或桌上的实物，必须先离开应用、变成一个文件，再从取景器里回来。

客户端也没有视频输入：prompt 的一部分是图片，或是由 `document-extract` 产出文本的文件，而模型读取的是图片。因此录下的一段片段没有办法以片段的形式进入一轮对话。

## Decision

菜单里的 Camera 行在 composer 的 input 域中打开一个弹窗，由 `Modal` 原语绘制，因此它的遮罩、圆角、投影和关闭控件与客户端里其它对话框完全一致。主体是一块 4:3 的圆角舞台，展示镜像的前置相机实时预览（手机的自拍视角就是这样），上面浮着一枚黑色胶囊，用两个 lucide 图标选择静帧或片段，当前模式是一枚白色圆盘。舞台下方是计时圆盘、快门和翻转圆盘；角落的胶囊读出录制计时与已采样的帧数。图标全部来自 `ui-primitives`（`timer` 与 `video` 的 lucide 路径转录在那里），每一句文案都是 locale key。

静帧模式把当前帧编码为一张 JPEG，交给 `InputActions.addImageFiles`，也就是 composer 自己的输入口：取景器、拖放和相机共用同一条路径，于是图片限额、对应提示以及繁忙阶段的拒绝都只在一处。它的快门默认先数三秒：计时圆盘可以关掉这段倒计时，再按一次快门则中途取消，读者看到的数字就是剩余秒数——静帧常拍的是需要一点准备时间的人。片段模式用 `MediaRecorder` 直接录制媒体流——浏览器支持时是 WebM/VP9 加 Opus，三十秒自行停止——在取景框里回放该文件，并在 `Use` 时交给文件输入。两种拍摄都要等到 `Use`：快门从不关闭弹窗，`重拍` 丢弃结果而不离开。

`capture.ts` 拥有纯 DOM 的部分：`openCamera` 把被拒绝的 `getUserMedia` 区分为 `permission` 或 `unavailable`（权限拒绝与设备不存在读起来是两回事），`grabFrame` 按媒体流自身尺寸编码一帧，`elapsedLabel` 格式化录制时钟。`CameraDialog` 拥有媒体流的生命周期：每次打开、每次切换朝向、每次重试各自一条流，并在效果的清理函数里停止，因此摄像头指示灯不会比弹窗活得更久，切到另一枚摄像头时也会先释放前一条。

片段以帧的形式到达，是因为下游没有任何一处读取视频：附件要么是图片，要么是被抽取成文本的文件。把帧发出去，录制的内容才对模型可见；确认步骤展示的正是将要发送的内容，而不是一个会被丢弃的片段。

## Consequences

相机是 composer 的功能而非某个 target 的功能：Hero 与停靠的 composer 里是同一个弹窗；在缺少 `addImages` 的场合它不可用，因为菜单行与输入口共用同一个条件。片段录下声音，并在三十秒处停止。模型收到的是片段的事实——时长、画面尺寸、编码、容器、大小——而不是它的画面或声音，因此关于片段展示了什么的问题只能依据这段描述回答。

## Verification

`camera-capture.client.spec.ts` 固定了两种拒绝类型、编码器的失败分支以及时钟。`camera-dialog.client.spec.tsx` 用桩替的相机、canvas 和 object-URL 表驱动弹窗：前置相机打开、翻转释放前一条流、权限被拒后可以重试、静帧以一张 JPEG 到达 `onCapture`、片段的采样按间隔累积、满帧后自行停止、被拒的帧只被丢弃而不终止录制，以及 `Cancel` 从不捕获。`input-bar.client.spec.tsx` 中的增补菜单用例固定了五行的顺序，以及 Camera 行会打开这个弹窗。

## Alternatives considered

**MediaRecorder 加一个可播放的片段。** 这样可以回看真实片段，但没有路径能承载它：文件输入只接受 `document-extract` 的格式，wire 上也没有视频部分。回看采样帧展示的正是模型收到的内容。

**独立成一个 client package。** 这个弹窗是 composer 的 UI，读取的是 composer 自己的输入口，也不持有别人共享的独立状态，因此它属于 `ui-conversation` 的 input 域，而不是一个需要 slot 与 store 才能触达同一批动作的插件。
