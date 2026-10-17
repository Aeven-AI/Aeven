# Agent Note: Account picture upload and the plan in the account menu

Status: implemented

[English](2026-10-17-account-picture-and-plan-menu.md) | 中文

## Problem

Aeven 账号能显示一张图片，却始终无法更换它。`profile.avatar` 只在提供方登录携带图片时写入，因此账号设置画出的永远是账号到手时的那一张：既没有上传，也没有回到首字母的途径。账户菜单写出了读者身份，并提供设置与登出，却没有说明其所在方案；图片与名字也都不通向任何地方——想改动其中任一项的读者得进入设置，再按名字找到那一页。

## Decision

账号设置顶部的身份行提供一个照片控件，账号已有图片时再提供一个删除控件；点击图片本身也会打开选择器，因为那正是想换一张图片的读者会点的地方。两者都经由已发布的读者完成：`setImage` 以 multipart 携带读者 bearer 把文件发送到 `/upload-avatar`，`removeImage` 发送到 `/delete-avatar`；两者都通过 `session.adoptImage` 采纳回答并重新声明读者。该行同时把返回的 URL 留在自身状态里，因此页面立即重绘，而不必等待读者被再次读取。

图片归 node API 所有。`ImageService.saveAvatar` 用 sharp 把上传重新编码为正方形 WebP——`config.file.avatarSize`（512）与 `avatarQuality`（82）——写入静态处理器所服务的图片目录，并回答 profile 记录的字段：`url`、`contentType`、`width`、`height`、`updatedAt`。`UserService.setAvatar` 先认证 bearer 并检查上传内容，再解码（PNG、JPEG 或 WebP，最大 `config.file.avatarMaxSize`；其它类型为 `415 invalid-image-type`，解码器不接受的内容为 `400 invalid-image`），记录新头像，然后删除被替换的那张。`deleteAvatar` 取消 `profile.avatar` 并删除该文件。路由把超大上传回答为 `413 image-too-large`，而不是让 multer 的错误抵达 Express 的 HTML 页面；`/upload-avatar` 是唯一带该上限的路由——聊天上传仍保持 50 MiB 的上限。

`ImageService.removeAvatar` 只删除本服务写入的路径。存储值若是提供方的远程 URL、爬出图片目录的路径，或目录项 `.` 与 `..`，都会被忽略，因此 profile 携带的值永远不会把一次删除变成磁盘别处的 unlink。

账户菜单在读者名字下方写出方案。它通过与账号页共用的缓存读取 `/api/cloud/subscription`，因此在任一界面做出的方案变更都不会让另一处保留旧答案；被拒绝或无法抵达的读取不会画出方案行，而不是显示菜单无法处理的错误。图片与名字构成菜单的第一行，发出带 `account` 的 `settings/open`；其下的设置行仍打开设置着陆页。

## Alternatives considered

**把图片留在页面而不是账号上。** 否决：图片是账号层面的事实。读者在这台机器上传后，期望账户菜单、下次加载以及他们的其它客户端都画出它；页面本地图片还得在客户端无法拥有的某处重新编码或限制大小。

**按原样保存上传的字节。** 否决：它对体积、格式与原件携带的元数据都没有改善。手机照片有好几兆，可能是 HEIC 或 12 位 JPEG，也可能带着位置信息；重新编码一次就同时约束了这三者，这也正是被服务的图片从不是读者交来的那个文件的原因。

**让菜单自己发起一次路由调用读取方案。** 否决：同一事实的两个读取方在变更后必然不一致。菜单与账号页共用一次读取缓存，页面做出的任何写入都会丢弃它。

**挂载时就读取账户类型，而不是首次打开时。** 否决：头像在页面的整个生命期里占据常驻条，而多数读者从不打开菜单。改为首次打开时读取，使不打开菜单的读者所在页面的请求量保持不变。

**保持资料行不可交互，只添加方案行。** 否决：图片与名字就是读者本人，它们天然是通往关于其自身页面的入口；把读者先送到设置着陆页、再让他们自己选账号，会把最短的路变成最长的路。

## Consequences

读者可以在账号设置里设置并清除自己的图片，账户菜单也写明了方案，并从图片与名字通向账号页。存储的图片是正方形 WebP：非正方形上传会被裁剪而非留边，动画图片只保留第一帧。

读者是声明在页面上的，而不是被订阅的。身份行依据自身状态更新，常驻头像则在下一次渲染时显示新图片——打开菜单或离开设置都会触发这次渲染——而不是在上传的同一时刻。要让该角落订阅，就意味着在属于 `ui-layout` 的 `shell.corner` 槽位上声明 store 或 hook 份额，为一张头像反转层次。

被替换的图片在新图片记录之后才删除，因此清理失败只会留下一个无人引用的文件，而不会留下损坏的 profile；图片从不会在其替代者存储之前被移除。

## Testing

`tests/unit/services/ImageService.test.js` 在临时目录中用真实的 PNG 与 JPEG 素材驱动真实的 sharp 流水线：无论源格式与长宽比如何，存储的文件都是配置尺寸的 WebP；不可解码的字节会被拒绝；`removeAvatar` 删除自己的文件，同时忽略提供方 URL、路径穿越、`.`/`..` 以及已经不存在的图片。`tests/unit/services/UserService/avatar.test.js` 固定账号一侧：profile 记录存储后的字段，被替换的图片被删除，缺少用户、缺少文件、空上传、不接受类型、不可解码字节与数据库失败各自回答相应的拒绝。客户端一侧，`tests/account-picture.client.spec.tsx` 覆盖该行的上传、取消选择、删除、两种失败提示与忙碌文案，`tests/api.client.spec.ts` 固定 multipart 形状、bearer，以及每种回答采纳进页面会话的内容。
