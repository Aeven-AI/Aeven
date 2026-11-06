# Agent Note: Motion 影片可在账户的其他设备上播放

Status: implemented

[English](2026-11-06-motion-film-on-other-devices.md) | 中文

## 问题

Motion 卡片从提供页面的 Host 的 `/api/motion/preview` 取回影片，并以运行 `show_motion` 的设备上的绝对路径指明合成文件夹。同步到另一台设备（例如托管 Web）的对话保留了卡片，却没有该文件夹，而托管部署不挂载 `api-motion`，因此卡片在影片的位置显示 "not found"。

## 决策

`ctx.motion` 新增 `bundle(compositionDir)`，返回打包成一个自包含 HTML 文档的合成；`avn-motion-hyperframes` 用 `bundleToSingleHtml` 实现它，`api-motion` 的预览路由返回它。`show_motion` 把该文档存为 `text/html` 文件附件，并在结果与展示元数据中记录为 `film`，因此会话同步会随对话发布它。卡片仍先向自己的 Host 请求文件夹的实时预览，预览失败时播放已存影片；播放已存影片时，下载保存的是该 HTML 文档，因为导出 MP4 需要持有文件夹的 Host。打包器拒绝的合成，或超过附件大小上限的合成，只保留实时预览。

## 备选方案

在每次 `show_motion` 调用时渲染 MP4 的方案被否决：它耗时约等于影片时长，而打包只需片刻。同步合成文件夹本身需要为每个聊天文件夹启用工作区文件同步，而托管部署不挂载它。

## 影响

另一台设备上的卡片播放的是该次调用时的影片，而不是文件夹之后的修改。此改动之前的调用没有已存影片，在其他设备上仍会失败，直到再次运行 `show_motion`。模型可见的结果文本不变。

## 验证

motion 各包与 `ui-imagine` 的类型检查和构建均通过。
