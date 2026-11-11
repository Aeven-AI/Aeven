# Agent Note: Markdown 图片通过会话的工作区路由加载

Status: implemented

[English](2026-11-11-markdown-images-load-through-the-workspace-route.md) | 中文

## Problem

助手刚做好的一张图片嵌入回复后，在托管版 Web 上不显示。`![](logo-out/aeven-mark.png)` —— 模型为它正在操作的工作区里的文件写出的形式 —— 变成了替代文本（alt）；替代文本为空时更是什么都不显示，于是读者和模型都以为回复没有问题。

两条规则在这处空隙里相遇。渲染器的图片解析只接受 `https:` 源和本地绝对路径，对后者拼出 `/api/file?path=…`；`LINK_SAFETY.allowedImagePrefixes: ['https://', '/']` 在解析器看到工作区相对源之前就把它拦掉。而服务多个账户的 Host 根本不挂载 `/api/file`：`pathReads: false` 会跳过 `SessionMediaReferences`，因为该路由可读取进程能读的任何路径（见[托管读取命名会话的笔记](2026-11-06-hosted-reads-name-a-session.zh.md)）。于是解析器能拼出的唯一 URL 并不存在，而该 Host 唯一能提供的源形式又被拒绝。单账户桌面 Host 上同样的 markdown 却能显示，因为那里存在 `/api/file`，第一次尝试的绝对路径至少到达了一条路由。

## Decision

`ui-chat` 把助手写出的每个本地图片解析到会话作用域的 `/api/workspace-file?sessionId&path` 路由 —— 两个 profile 都注册了它：`workspaceImagePath` 指出工作区内的文件（工作区内的绝对路径剥掉工作区根，相对路径原样保留），`assistantImageUrl` 优先用此前 `read_image` 存下的持久副本，其次才是工作区 URL。带协议的源、协议相对源、工作区之外的绝对路径都解析为 undefined，仍由其自身的解析器决定。`workspaceFileUrl` 移到 `@aeven/client-ui-primitives`，文件侧栏与 Chat 共用一种形式。

`hypermarkdown` 在 `linkSafety` 上新增 `allowRelativeImages`（默认 `false`）：当宿主声明由自己解析无协议、无根斜线的图片源时放行。它只作用于图片，不作用于链接，也绝不放过协议相对源。`ui-primitives` 为助手 Markdown 打开它 —— 那里的解析器才是把源变成工作区 URL 或替代文本的关口。

## Alternatives considered

**托管版也提供 `/api/file`，限制在调用者的目录内。** [托管读取笔记](2026-11-06-hosted-reads-name-a-session.zh.md)已否决：该路由不携带会话，限定范围需要在工作区路由已解析的账户到目录规则之外再加一套。

**让助手只写绝对路径。** 模型无法知道托管工作区的绝对路径 —— 它随账户与设备而变 —— 而且上述笔记仍记录这种路径在托管版不加载。要求模型写绝对路径，等于继续拒绝工作区形式，同时把它指向一条不存在的路由。

**把每个嵌入的图片复制进附件库并重写 markdown。** 图片因此获得现有路由可提供的持久路径，但会改变模型所写的内容，为工作区已有的图片重复存储，并且需要对每条回复做一次模型可见的重写。

**把 `allowedImagePrefixes` 放开为 `['*']`。** 解析器仍会拒绝它提供不了的一切，但净化器就不再是第二道意见；选择窄开关的理由是：新权限有名字、可测试。

## Consequences

助手写进工作区的图片现在在托管版 Web 与桌面上都能显示，无论源是相对路径还是工作区内的绝对路径。指向工作区之外的源在托管版仍只显示替代文本，因为没有路由提供它。未解析的情况依旧静默 —— `MarkdownImage` 只渲染替代文本、不显示任何标记 —— 所以写错的路径对读者仍不可见；让该状态可见留待后续。

## Verification

`packages/client/ui-chat/tests/workspace-images.client.spec.tsx` 覆盖各种源形式（相对、工作区内外的绝对路径、`https:`、`http:`、`data:`、协议相对、百分号转义、未知工作区根）、持久副本优先，以及一次经 markdown 引擎的渲染并断言 `img` 的 src。`packages/client/hypermarkdown/tests/unit/security/link-safety.client.spec.ts` 覆盖相对放行的开关与协议相对的排除；sanitize 规格固定了新的默认值。`pnpm run test:gui` 与 typecheck 通过。
