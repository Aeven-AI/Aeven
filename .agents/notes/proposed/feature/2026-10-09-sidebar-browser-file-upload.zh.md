# Agent Note: 侧边栏浏览器中的文件上传

Status: proposed

[English](2026-10-09-sidebar-browser-file-upload.md) | 中文

## 问题

会话旁的浏览器无法应答文件选择器。`automate()` 实现了 `snapshot`、`click`、`type`、`press`、`scroll`、导航与 `evaluate`，没有任何一项能填充 `input[type=file]`；仓库中也没有任何东西拦截文件选择器。因此，点击任何“从计算机上传”控件都会打开一个没有任何工具能完成的原生 macOS 打开对话框。

2026-10-09 给一条 LinkedIn 帖子附一张图片时出的问题：

- 模型退回到用 computer use 操作桌面：把文件复制到 `~/Downloads`（在工作区之外，因此是一次升级写入），点击控件，截屏，把截图像素转换成屏幕点，点击文件行，点击 Open。它需要辅助功能与屏幕录制授权、一个可见桌面，而且无法在无 GUI 的 Host 上运行。
- 之前先撞上两条死路：剪贴板里有图片时，`preview_press` Meta+V 什么都没插入；从页面执行 `fetch('http://127.0.0.1:<port>/image.jpg')` 返回 `Failed to fetch`（CSP 与 Chrome 的私有网络策略）。
- 输入正文同样慢，原因相同：`type` 分段插入，每段暂停 45 毫秒，因此 1,278 个字符大约花八秒。
- 两次失败抛出都说“the target is not an editable element”，不管真实原因是什么。

## 已实现的范围

[快速侧边栏操作决策](../../implemented/feature/2026-10-09-fast-sidebar-browser-actions.zh.md)实现了原子上传、整段文本输入、审批、取消与本地操作序列。下面的独立点击后记住选择器流程仍属提案。按用户的指示，验证仅限 TypeScript 与构建。

## 提案

1. 新增一个 `upload` 操作（`packages/web/tool-browser/src/types.ts` 中一个联合成员，以及 `apps/desktop/src/browser-automation.ts` 中的 `automate()` switch）：它解析 `input[type=file]`——按选择器、按点击点，或从点击刚打开的选择器——并用 `DOM.setFileInputFiles` 填充。在 `packages/web/tool-browser/src/index.ts` 中把它暴露为 `preview_upload { selector?, x?, y?, paths: string[] }`，并返回文件名，绝不返回路径。与所有其他 `preview_*` 工具不同，它会读取本地文件系统，因此它的路径应当查询 `sandboxPolicy`，而不是加入 `packages/guard/access-policy/src/index.ts` 的 `DEFAULT_EFFECT_TOOLS`——那些条目存在的理由恰恰是它们*绕过*文件系统沙箱。把它写进 `packages/web/tool-browser/README.md`（以及 `.zh.md` 与 i18n 伴随记录），并在新用户的 agent 会加载的 `in-app-browser` skill 中点名它（`packages/preset/agent-presets/presets/aeven/skills/in-app-browser/SKILL.md`），否则 agent 永远不会知道它存在。IPC 这一跳什么都不需要：`browser-guests.ts` 只检查该操作是字符串，并把它传给 `automate()`，因此联合成员与 switch 分支就是整个接触面。
2. 拦截选择器（`Page.setInterceptFileChooserDialog`、`Page.fileChooserOpened`），使点击上传控件不会打开原生对话框；下一次不带选择器的 `preview_upload` 填充那个节点。现有代码还没有的两个细节：事件只在 `Page.enable` 之后到达，而 `automate()` 今天从不调用它，因此启用它必须与拦截配对；事件携带的 `backendNodeId` 可以直接交给 `DOM.setFileInputFiles`，无需 `DOM.querySelector` 查询。这正是 Playwright 的 `setInputFiles` 与 Puppeteer 的 `uploadFile` 所用的组合，因此是老路而非新发明。
3. 超过约 200 个字符或含换行的文本用一次 `Input.insertText` 插入；短字符串保留可见的逐字输入。
4. 返回是哪种失败：没有匹配项、元素无法获得焦点，或焦点移开了。
5. 在会话中首次向远程来源上传之前请求审批，显示来源与路径；localhost 除外。

## 考虑过的替代方案

**保留 computer use 作为有记录的兜底。** 它成功过一次，但需要屏幕录制与辅助功能授权、一个可见桌面，以及工作区之外的一个文件——一种在无 GUI 的 Host 上会失败的首次运行体验。已否决。

**用页面抓取的本地 HTTP 服务器填充输入框。** 页面返回 `Failed to fetch`，而且每次上传都需要一个服务器。已否决。

**从桌面剪贴板粘贴文件。** `preview_press` Meta+V 在 Quill 编辑器中什么都没插入。已否决。

## 验收标准

- 仅靠 `preview_upload` 就能在面板中附上文件：无需 computer use、无需授权、无原生对话框。
- 点击上传控件不会让会话卡住；下一次 `preview_upload` 填充它。
- 长正文一次插入完成，并保留段落分隔。
- 覆盖：`packages/web/tool-browser/tests/tool-browser.spec.ts` 中的工具名列表与描述；新增的 `apps/desktop/tests/browser-automation.spec.ts`（今天没有 spec 覆盖 `automate()`）覆盖节点解析、已记住的选择器节点、非输入元素的拒绝与一次性长文本；再加一个固定 preview 工具接触面的录制会话快照——目前都不存在，因此按 `snapshots/AGENTS.md`，这次改动会新增一个。
- 两个包都通过 `pnpm run test`，并通过 `pnpm run typecheck`、`pnpm run lint` 与 `pnpm run test:docs`。

## 风险

拦截选择器影响每个页面，因此拦截与应答它的操作一起交付，而首先要证明的是 Electron 的 guest 中真的抑制了原生 macOS 对话框：把调试器附到带上传控件的页面，点击它，在它之上构建任何东西之前断言没有对话框出现。`DOM.setFileInputFiles` 把文件内容交给页面，上传本来就是这样，因此有了第 5 项改动中的审批。带多个文件输入框的页面可能被填错；本提案偏好显式选择器，并对歧义直接拒绝，而不是猜测。
