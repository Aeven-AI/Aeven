# Agent Note: 桌面 Host 遵循系统代理与证书库

Status: implemented

[English](2026-11-16-desktop-host-follows-system-network-settings.md) | 中文

## Problem

在一个企业网络上，桌面用户既无法聊天也无法登录，而同一台机器上的托管网页版可以正常使用。API 访问日志显示了来自桌面渲染进程的令牌刷新（它们经由 Electron 的 session 到达 Aeven），却没有来自 Host 的任何请求：没有推理，没有连接器调用，也没有登录校验。渲染进程的请求经过 Chromium，它遵循系统代理设置、PAC 脚本、WPAD 和操作系统证书库。Host 运行在自带的上游 Node.js 下，其 `fetch` 直接连接，且只信任 Node 自带的根证书。因此，要求代理的网络，或用管理员装入系统证书库的根证书重新签发证书来检查 HTTPS 的网络，会放行渲染进程而拦下 Host 的每个请求。

## Decision

- `DesktopHostProcess` 以 `NODE_USE_SYSTEM_CA=1` 启动 Host，使 TLS 在 Node 自带根证书之外也信任操作系统证书库。Host 启动的 Node.js 子进程继承该变量。
- 桌面 Host 协议第 7 版在 Node IPC 上新增一个询问和一个回答。Host 为 `http:` 或 `https:` URL 发送 `{ type: 'resolveProxy', id, url }`；桌面壳回答 `{ type: 'proxy', id, routes }`。`apps/desktop/src/system-proxy.ts` 把 `session.defaultSession.resolveProxy(url)`（登录和每个渲染进程请求使用的 session）转换为有序路由：`PROXY` 与 `HTTPS` 条目变为 `http:` 与 `https:` 代理 URL，`DIRECT` 变为 `null` 并结束列表，SOCKS、QUIC 以及带凭据或路径的条目被丢弃。解析失败时回答 `[null]`。
- `apps/desktop-host/src/system-proxy.ts` 在第一个插件挂载前安装全局 undici dispatcher。每个非回环请求等待其路由，然后交给唯一的直连 agent 或每个代理 URL 一个的代理 agent。回环目标不询问而直接连接。桌面壳的 IPC 通道关闭时（例如桌面壳退出后 Host 继续服务），每个请求都直接连接。
- 回退与 Chromium 一致。在 undici 的 `onRequestStart` 之前连接失败（`ECONNREFUSED`、`ETIMEDOUT`、`EHOSTUNREACH`、`EHOSTDOWN`、`ENETUNREACH`、`ENETDOWN`、`ENOTFOUND`、`EAI_AGAIN`、`UND_ERR_CONNECT_TIMEOUT`）的请求，带着未读取的请求体转到下一条路由。无法连接的代理在五分钟内（Chromium 自身的坏代理延迟）排到其他路由之后，再次连通即清除标记。已作出应答的代理，即使是拒绝或重置，也保留该请求。

## Alternatives considered

**在桌面壳启动 Host 时解析一次系统代理并以 `HTTPS_PROXY` 传入。** 否决：环境变量在 Host 生命周期内固定。离开办公室的笔记本会继续把每个请求发往已无法连接的代理，使今天能用的用户无法使用。PAC 脚本还可以按目标选择不同的代理，一个变量无法表达。

**在 Host 中用 `scutil --proxy` 读取 macOS 代理设置。** 否决：这会把 PAC 与 WPAD 求值留给 Host，并且在 Windows 和 Linux 上各需一个读取器。Chromium 已经对它们全部求值、缓存 PAC 结果，并在网络变化时重新读取设置。

**让 Host 的 Aeven API 请求经过 Electron 的网络栈。** 本次否决：它还能覆盖代理认证（NTLM、Kerberos），但需要一条从 Host 到桌面壳、用于推理和上传的第二条流式传输，而且只覆盖 Aeven 自己的端点，不覆盖连接器、网页搜索或 MCP 服务器。

**只取第一个可用的 PAC 条目。** 端到端测试后否决：企业 PAC 通常以 `PROXY corp:8080; DIRECT` 结尾，离开办公室时代理无法连接。Chromium 此时直接连接；没有回退，Host 会在本次改动前能用的地方失败。

## Consequences

- 要求代理的网络（由固定设置、PAC 或 WPAD 选择），或用装入系统证书库的根证书检查 HTTPS 的网络，不再把 Host 与渲染进程分开。
- 每个非回环 Host 请求在连接前增加一次到桌面壳的 IPC 往返。
- 未覆盖：需要认证的代理、只有 SOCKS 的代理（Host 改为直接连接）、自带 dispatcher 的调用方（网页抓取工具固定的直连传输），以及不接收代理环境的 Node.js 子进程。拦截自带 `node` 可执行文件本身的防火墙或终端代理不在本次改动范围内。
- `apps/desktop/tests/system-proxy.spec.ts`、`apps/desktop/tests/host-process.spec.ts` 与 `apps/desktop-host/tests/system-proxy.spec.ts` 覆盖 PAC 解析、IPC 交换、逐请求路由、带请求体的回退、坏代理延迟，以及经全局 dispatcher 的 Node 内置 `fetch`。
