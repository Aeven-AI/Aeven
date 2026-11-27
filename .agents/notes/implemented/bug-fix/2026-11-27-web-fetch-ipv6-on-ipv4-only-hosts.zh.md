# Agent Note：仅 IPv4 主机上的网页抓取

Status: implemented

[English](2026-11-27-web-fetch-ipv6-on-ipv4-only-hosts.md) | 中文

## 问题

2026-11-27 09:03 UTC，pink 上的托管 Host 以状态 1 退出，systemd 将其重启。最后一条日志是一个 `web_fetch` 产生的、未处理的 `TLSSocket` `ENETUNREACH` `error` 事件；目标主机同时解析出 IPv6 和 IPv4 地址。pink 只有链路本地 IPv6 地址，没有 IPv6 路由。glibc 的 `AI_ADDRCONFIG` 会把链路本地地址计入，因此 `getaddrinfo` 在那里仍返回 AAAA 结果。[`@aeven/web-fetch-http`](../../../../packages/web/web-fetch-http/README.zh.md) 固定了两个地址族，并让 Undici 的 `autoSelectFamily` 连接在它们之间竞速。在 pink 上用 IPv6 在前的固定地址集合做的独立复现，大约十五次中有一次抛出同样的未捕获 `ENETUNREACH`；之前的 Oracle Host 具有相同的 IPv6 配置、代码、Node 版本和单元配置，从未记录过该错误。

## 决定

当没有任何本地网卡持有环回和链路本地范围之外的 IPv6 地址时，`resolvePublicAddresses` 的默认解析器会丢弃 IPv6 结果；该判断在每次解析时从 `os.networkInterfaces()` 读取。连接因此不会尝试主机无法到达的 IPv6 目标。测试传入的解析器不受影响；拥有可路由 IPv6 地址的主机保留两个地址族和 `autoSelectFamily`。

## 考虑过的替代方案

**`dns.ADDRCONFIG` 提示**被否决：在 pink（glibc 2.39）上，由于链路本地地址，它仍返回 AAAA 结果。**`/etc/gai.conf` 中的 IPv4 优先规则**只调整结果顺序，只作用于一台机器，并让仅 IPv4 网络上的桌面端仍然暴露。**关闭 `autoSelectFamily`** 会让 IPv6 在前的结果在确有 IPv6 的主机上失败。

## 影响

在仅 IPv4 的主机上，只有 AAAA 结果的主机名会以 `WEB_PROVIDER_ERROR` 解析失败，而不是连接错误。在拥有可路由但不通的 IPv6 路径的主机上，Node 连接回退中的竞态仍可能出现；该情形没有复现。
