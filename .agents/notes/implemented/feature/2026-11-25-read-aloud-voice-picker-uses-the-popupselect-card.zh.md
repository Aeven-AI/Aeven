# Agent Note：朗读声音选择器使用 popupSelect 卡片并新增 Settings 一行

Status: implemented

[English](2026-11-25-read-aloud-voice-picker-uses-the-popupselect-card.md) | 中文

## 问题

composer 的系统语音一行打开的是自行设计的卡片：按语言分节的列表，每种语言一个吸顶标题，当前声音尾部带勾。它旁边的图像模型与视频模型行打开的是 `ui-commands` 的共享 popupSelect 卡片，带搜索框，表面与行样式都不同，因此三个相邻的行打开两种弹出层。声音卡片无法搜索，而目录包含数十种语言。声音也只能在 composer 中选择，不能在设置听写模型的 Settings 中选择。

## 决定

composer 中的这一行通过 `commandUi.openSelect(sessionId, 'voice', spec, row, 'beside')` 打开 popupSelect 卡片，模型行经由 `invokeFromButton` 到达的正是这一调用。第一张卡片列出语言，以声音数量作为行的详情、以语言子标签作为搜索关键词，因此卡片的搜索匹配语言名称或其代码。选择一种语言会以该语言的声音再次调用 `openSelect`：先是默认（注明它解析到的声音），然后是每个声音，当前选择标记为 `active`。第二次打开会替换控制器的绑定，因此已完成的语言选择返回时不会关闭卡片。选择声音会写入 `localStorage` 中已有的按语言偏好。该行在 `ctx.inject(['commandUi'])` 内注册，与 `ui-imagine` 注册其选择器的方式相同。

Settings → General → Voice 新增 `settings.voice.item` 列表，`ui-voice-input` 的 Voice 组在听写模型行之后渲染它，`ui-tts` 在其中注册朗读声音一行。popupSelect 卡片只在 composer 的覆盖层槽位中渲染，因此这一行绘制该卡片的标记、按键与样式表：`VoiceSettingsRow.module.css` 逐条复制 `PopupSelectView.module.css` 与 SettingsSelect 的胶囊按钮，只改变卡片的定位，从胶囊按钮处固定定位在设置面板之上。Escape 关闭卡片，不会到达设置面板的 document 监听器。两处都用 `voices.ts` 中的 `languageRows`、`voiceRows` 与 `filterRows` 构建行。

## 考虑过的替代方案

**保留分节卡片并为其加搜索框。** 这会在模型行旁边保留第二种弹出层设计，而这正是本次修改消除的不一致。

**把所有声音列成一个平铺列表，以语言作为详情。** 这会丢掉每种语言的默认行，并在选定语言之前列出数百行。

**从 `ui-commands` 导出一个展示型卡片。** 这能让 Settings 渲染该卡片而不是复制其样式表，但会为一个使用方拆分共享外壳；复制的样式表注明了来源，便于两者对照。

## 影响

composer 中选择声音需要两次选择：先语言，后声音。Settings 卡片与 popupSelect 卡片通过复制的样式表保持同一外观，因此对 `PopupSelectView.module.css` 的修改必须同步到 `VoiceSettingsRow.module.css`。偏好仍保存在本浏览器的存储中，与之前相同。
