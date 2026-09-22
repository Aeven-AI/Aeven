# Agent Note: loopback URL 在知道请求的一侧被改写

Status: implemented

[English](2026-09-22-loopback-urls-are-rewritten-where-the-request-is-known.md) | 中文

## Problem

以某种 loopback 拼写提供的页面会拿到另一种拼写的部署 URL：读者在 `localhost:3060` 上收到的 API 地址是 `http://127.0.0.1:9000`——对浏览器而言是另一个 origin，会话 cookie 不会随之发送，页面创建的会话它也永远读不回来。客户端事后用 `sameSiteOrigin` 修补，这只有在页面已经处于读者的拼写上、且仅对客户端读取的那些 URL 才有效。

`webserver/index-inject` 做不到更多：钩子拿到注入表，却拿不到请求，于是监听者只能照配置原样陈述。

## Decision

事件携带请求的 origin。`collectIndexInjections(origin?)` 与 `renderIndex(html, origin?)` 把它贯穿下去，`frontend-static` 从请求中读出它（`Host` 加 `X-Forwarded-Proto`，因为终结 TLS 的代理背后套接字并未加密），`identity-user-aeven` 在推入自己的行之前把每个配置 URL 陈述为该拼写。

`sameHostLoopbackUrl` 只移动主机名，且仅在配置值与请求双方都是 loopback 时：端口与路径保持配置原样，真实部署与 provider 自有域名原样通过，无法解析为 URL 的值按陈述原样交出。它在配置字符串内部重建 authority，而不是绕经 URL 解析，因为往返解析会给不带路径的 origin 添上结尾斜杠。

客户端为没有请求的注入（worker boot payload）保留自己那份四个 loopback 拼写；两侧的测试各自列出同样四个，改动一侧时另一侧被阅读即可见。

## Alternatives considered

删除客户端规则被否决：worker boot payload 没有请求，那些 URL 将完全无人改写。共用同一个谓词也被否决：客户端无法导入 Host 包，而为一个四元素集合引入浏览器值依赖需要声明模块请求并配置供应方。只在客户端掩盖同样被否决，因为它覆盖不了书签、第二个端口或代理。

## Consequences

- 以 `localhost` 到达的页面现在拿到 `http://localhost:9000`，以 `127.0.0.1` 到达的拿到 `http://127.0.0.1:9000`；`https://aeven.ai` 与 provider 域名原样不变；客户端规则作为幂等兜底保留。
- 事件签名是追加式的：忽略第二个参数的监听者照常工作。
- 测试：注入配置的六个用例（两种 loopback 拼写、生产环境原样、无 origin 的注入、无法解析的值）、`requestOrigin` 的头与套接字语义，以及组合后的服务器把 origin 交给监听者。
- 尚未覆盖：对运行中的页面服务器做请求级成对验证（`curl -H 'Host: …'` 两次）。9000 端口上的部署提供的是 API 而非页面，因此该检查需要另起一个 `avn web` 实例。
