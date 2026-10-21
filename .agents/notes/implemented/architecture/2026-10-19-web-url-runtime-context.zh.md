# Agent Note: GUI 地址属于运行时上下文，而非提示词正文

Status: implemented

[English](2026-10-19-web-url-runtime-context.md) | 中文

## 问题

`app:web-surface` 会话区段把 Aeven Web GUI 的地址写进了正文：`You are interacting with the user through the Aeven Web GUI at ${webUrl}.`。区段属于被缓存的系统提示词，因此服务器一旦换绑端口——端口被占用后重启、再开一个 `avn web` 实例——就必须改写该会话的提示词前缀。此后每一轮都从第一个变化的 token 起失去 KV 缓存复用，而换绑前创建的会话仍把旧地址留在指令里。

## 决策

**界面区段不再陈述任何与进程相关的值。** 它只说地址由运行时上下文给出；地址本身作为 `app:web-url` 进入运行时上下文，占 `WEB_URL`（order 210），文本为 `Aeven Web GUI URL: <url>`，每次组装时从当前服务器解析。

这一拆分遵循界面自身的规则：GUI 渲染什么、回复与图片如何呈现、采用哪种更新契约，都是关于界面的事实，属于区段；本进程绑定了哪个端口是关于进程的事实，属于每轮重建的上下文。`AVN_WEB_URL` bash 变量继续为 shell 使用方提供同一个实时值。

## 备选方案

**把地址留在 `app:web-surface`，换绑时重建会话提示词。** 重建前缀会从第一个变化的 token 起改写被缓存的系统提示词，因此换绑之后每一轮都失去 KV 缓存复用，而换绑前创建的会话仍保留服务器已不再提供的地址。

**只让 `AVN_WEB_URL` 携带地址，并在区段里点名该变量。** 模型只有运行 shell 命令才能读到变量，因此从不调用 bash 的那一轮根本没有地址；运行时上下文条目无需工具调用即可进入每次请求组装。

**绑定端口时把地址作为会话事件记录。** 绑定是进程状态而非对话状态：该事件每次换绑都要改写，而且在它之前挂载的会话仍然没有这个值。

## 后果

- 换绑会追加一条新的运行时上下文快照，而不改写提示词前缀，因此它之前的区段仍可缓存。
- 换绑之前创建的会话，在下一轮请求中读到当前地址，而不是启动时记下的那个。
- `surfaceContext: false` 仍然既不注册区段、也不注册上下文与 bash 变量。

## 验证

`packages/bundle/web-app/tests/web-app.spec.ts` 断言界面区段不再包含地址、`app:web-url` 携带 `Aeven Web GUI URL: <url>`，且渲染出的上下文快照包含该行；`apps/web/tests/expected/web-runtime-context/web-surface-prompt.expected.md` 固定区段文本。
