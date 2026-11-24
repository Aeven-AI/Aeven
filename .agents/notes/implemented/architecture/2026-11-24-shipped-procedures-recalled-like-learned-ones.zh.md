# Agent Note：内置流程像已学流程一样被召回，发帖输入框中的 Enter 不算发送

Status: implemented

[English](2026-11-24-shipped-procedures-recalled-like-learned-ones.md) | 中文

## Problem

Aeven 需要为每个用户提供网站操作知识，先从 LinkedIn 发帖开始：链接预览卡会隐藏 Media 按钮，两个不同的控件都标为 `Dismiss`，一条视频从不与图片同发。预设技能可以承载这些内容，但每个技能都会把描述放进每个会话的目录，每多一个网站，每场对话就更长。已学流程没有这项开销，因为记忆召回只提供与请求匹配的流程，但它们只按所有者存在，是该所有者的代理学到的内容。

录制 LinkedIn 流程时还发现发送守卫误判发帖输入框：在那里按 Enter 只会换行，守卫却询问"Send this message on linkedin.com"，而且审批卡对这次 Enter 和点击 Post 的显示完全相同，用户无法分辨换行与发布。

## Decision

### 内置流程

- `ctx.memory.ship(procedures)` 注册组合为每个所有者内置的流程并返回 disposer；`shipped()` 按名称各列出一条，以最早仍有效的注册为准。每条带有 id `shipped:<name>`（`shippedProcedureId`）、描述、最多 950 字符的摘要、完整流程和领域。
- 记忆服务把它们作为 `shipped` 加入每次轮次开始的 `recall`。`@aeven/memory-memos` 把它们与所有者的流程一起评分（名称与描述的嵌入，再看共有词语），并把选中的一条作为带摘要的 `active` 流程命中提供；所有者有同名且未归档流程的除外。当有内置流程符合条件、但没有一条排进前 `procedureCandidates` 名时，最佳的一条占据最后一个位置：在记录的检查中，所有者自己从单次运行学到的 LinkedIn 流程原本会排在内置流程之前。被提供的内置流程随后排在召回命中的最前面：在同一次检查中，未经判定的召回块用检索命中填满了 16,000 字符，排在其后的内置流程被排除在外。
- 服务自行回答对内置 id 的 `trace` `detail`，因此 `memory_get` 能读到完整流程；对内置流程的 `edit`、`forget` 和 `setProcedureStatus` 不触及提供方即拒绝。`procedures()` 仍只列出所有者自己的流程，所以 Settings → Memory 不显示内置流程。
- `@aeven/tool-capability` 在加载时从 `shippedProcedures`（绝对目录，每条流程一个 Markdown 文件，frontmatter 含 `name`、`description`、`summary`、可选 `domain`）读取，文件格式错误即加载失败，然后注册。对所有者没有同名流程的内置流程，学习器把它当作可更新的 active 流程提供；更新结果存为所有者自己的同名流程，对该所有者取代内置流程，状态与更新一条 active 流程时相同。
- Aeven 预设在其组合旁提供 `procedures/`；`linkedin-post` 是第一条流程。其步骤来自在侧栏浏览器中逐一录制的全部发帖输入框情形，期间未发布任何内容。

### 发送守卫与审批卡

- 当多行编辑器（`textarea` 或 `contenteditable`）所在的对话框、表单或文章显示一个标签以 Post 类动词开头的控件、且没有以 Send 类动词开头的控件时，外发探测把其中单独按下的 Enter 视为换行。聊天输入框显示 Send，单行输入框会提交表单，因此两者仍会询问；同时按住 Control、Meta 或 Alt 的 Enter 在 X 的输入框中会发布，同样仍会询问，`preview_press` 会把这种组合键交给探测。
- `ApprovalOutbound.trigger` 指明发布所用的输入：`{ kind: 'key', key }` 或 `{ kind: 'click', label }`；`preview_*` 的审批根据探测结果设置它，审批卡以中、英、西三种语言将其显示为"操作"一行。

## Alternatives considered

- **每个网站一个预设技能。** 否决，因为无论请求是什么，每个技能的描述都会进入每个会话的目录。
- **把内置流程复制到每个所有者的记忆中。** 否决，因为每个账户都会持有一份副本，Settings → Memory 会列出所有者从未创建的流程，而内置流程更新时还得区分未改动的副本和学习器修订过的副本。
- **在侧栏浏览器显示某网站时提供对应流程。** 否决，因为浏览器正显示其他页面时，像"把这条发到 LinkedIn"这样的请求将得不到任何流程。

## Consequences

- 内置流程只有在召回选中它时才占用轮次开销；新增一条流程就是在预设的 `procedures/` 中加一个 Markdown 文件。
- 内置流程只随发布版本更新，而所有者学到的同名副本不再接收这些更新。
- 若发帖输入框的 Post 控件在页面语言中不以已知的 Post 类动词标注，其中的 Enter 仍会询问。
