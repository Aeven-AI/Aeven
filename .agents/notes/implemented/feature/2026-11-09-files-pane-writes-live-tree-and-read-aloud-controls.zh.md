# Agent Note: Files pane writes, live tree, HTML preview, and read-aloud controls

Status: implemented

[English](2026-11-09-files-pane-writes-live-tree-and-read-aloud-controls.md) | 中文

## Problem

右侧栏的文件面板只能显示工作区而无法修改它；它一直保留首次加载的列表，直到重新打开；刷新时整个树变空；HTML 只能以源代码显示；而且固定的浅色在深色主题中几乎看不见。朗读在快速连按后可能卡在加载图标上，没有暂停，并且只存在于助手回复上。深色主题下，移动端键盘会露出白色的文档画布；“移动到工作区”菜单按注册表顺序而不是侧栏顺序列出工作区。

## Decision

- **写入。** `workspaceFiles` Remote（[`@aeven/api-workspace-files`](../../../../packages/api/workspace-files/README.zh.md)）新增 `access`、`createFile`、`createFolder`、`rename`、`duplicate`、`count` 与 `deleteEntry`。每次写入都像列举一样在工作区内解析条目所在的文件夹，按所有平台都拒绝的字符集校验新名称，并指明条目本身，因此符号链接被重命名或删除的是链接本身，从不跟随。它们在 Host 自身的文件系统上运行（[`host.ts`](../../../../packages/api/workspace-files/src/host.ts)），且仅当组合文件系统把工作区一一映射到该文件系统时可用；只读的 Session 在操作内拒绝它们，`access` 让面板将其显示为禁用并说明原因。`deleteEntry` 使用系统废纸篓（macOS 的 `trash` 或访达、Windows 回收站、`gio trash`），没有废纸篓时直接删除条目，`access.trash` 事先报告这一点，以便确认框说明是哪一种。
- **实时树。** `changes` 从每个工作区根目录的一个递归 `fs.watch` 流式发送批次，所有订阅者共享，并忽略 `searchSkip` 中的名称。面板把一阵变化合并为每个可见文件夹一次重新加载，把已加载但折叠的文件夹标记为过期，并就地重新加载打开的文件。没有变化流时，它在窗口重新获得焦点或可见时重新校验。
- **重新加载。** 重新加载在应答到达前保留文件夹的行，中止该文件夹之前的请求，丢弃已被取代的请求的应答，并以一次更新发布一次重新扫描的所有文件夹。刷新期间按钮旋转并被禁用，直到完成。
- **HTML 预览。** HTML 文件默认在仅带 `allow-scripts` 沙箱的 iframe 中渲染打开。页面在工作区中的样式表、脚本、图片与媒体通过应用读取并内联到其 `srcdoc` 中（[`preview.ts`](../../../../packages/client/ui-sidebar-files/src/client/preview.ts)），因为不透明来源的框架无法为这些请求进行身份验证。
- **树。** 行带有 `aria-level` 与漫游焦点，被忽略的名称藏在一个开关后面，只渲染可见窗口内的行，文件栏可在该面板的历史中后退与前进。行、停靠区与两条文件栏保持原有外观；只有关闭按钮改用主题令牌，以便在深色主题中清晰可见。
- **朗读。** 停止会清除通道的排空标志并中止排空中的等待，因此新的朗读从不等待被放弃的合成；排空属于其开始时的代次。`pause` 与 `resume` 挂起与恢复共享的音频上下文，播放时控件显示暂停（或播放）与停止。新的 `conversation.chat.user-actions` 插槽在用户提示的复制按钮之前渲染，承载同一控件。
- **主题画布。** 首页引导脚本与 ui-layout 的 ThemePresenter 都把 body 的计算背景色复制到 `html` 与 `theme-color` meta 中，并在外壳后放置一个固定的背景层。
- **移动目标。** 工作区浏览器向 `uiWorkspace` 报告其分组顺序，“移动到工作区”的目标随之排序；在报告之前，它们使用浏览器默认的按最近活动排序。

## Alternatives considered

**由预览路由提供页面自身的子资源**被否决：账户 cookie 为 `SameSite=Strict` 且只接纳精确路由，因此沙箱框架的子资源请求会被拒绝，而去掉沙箱又会把应用的来源交给工作区 HTML。**为 `fs` 能力增加 mkdir、rename 与 delete** 暂被否决：每个提供者（本地、沙箱、E2B）都需要为一个使用方实现它们；浏览器的写入留在自己的服务中，在其他环境中报告不可用。**通过停止音源并重新排队其余部分来暂停**被否决，因为它会重新合成并可能截断一个词。**在服务内根据持久化的视图存储排序移动目标**被否决：存储实例属于插槽框架，而浏览器计算出的顺序才是读者看到的顺序。

## Consequences

当工作区不在 Host 自身的磁盘上时（E2B），写入与变化流不可用。在 Linux 上，对大型目录树的递归监视对每个目录占用一个 inotify 监视。在没有废纸篓的 Host 上删除是永久的。浏览器的写入代表读者执行，经过客户端确认，而不经过 Agent 的审批流程。拖放、多选、在文件夹之间移动以及内容搜索尚未实现。
