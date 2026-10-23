# Agent Note: 连接器登录在后台完成

Status: implemented

[English](2026-10-23-connector-consent-settles-in-background.md) | 中文

## 问题

Aeven API 已经完成的服务商登录在设置中仍显示为关闭。`AccountIntegrations` 只在 `settleConsents` 中把已完成的授权变成连接器，而只有 `list()` 会调用它，因此连接器只会在设置页恰好重新列出时出现：挂载时、窗口 `focus` 事件时，或收到 `skills/change` 时。读者若在 Aeven 仍然可见的情况下看着服务商的“已连接”页面，窗口就不会获得新的焦点，连接器会一直关闭，直到重新打开该页面。

## 决策

`authorize()` 会启动 `watchConsents()`，它每隔 `consentPollMs`（默认 2000）处理所有所有者的待定授权，直到没有待定授权为止。处理一个已完成的授权会存储连接器并调用 `invalidateSkills()`，其 `skills/change` 事件正是设置页已在监听的，因此页面会重新列出，并在一个间隔内显示连接器。授权失败以及 Slack 登录失败同样调用 `invalidateSkills()`，让页面以同样方式显示失败。监视计时器随服务的连接器作用域 effect 一起清除。

后台监视与设置页的 `list()` 可能同时处理同一个已完成的授权；`settleConsents` 在 API 应答后重新检查 `consent.completion`，第二个调用方等待第一个的完成，而不是把授权完成两次。

## 考虑过的替代方案

**在登录待定期间由设置页轮询。** 每次轮询都要运行完整的 `list()`——技能列表、连接器检查以及 WhatsApp 与 Telegram 刷新——只为得知一个授权的状态，而且只有打开的设置页才会处理它。

**由 Aeven API 把完成结果推送给 Host。** API 到本地 Host 之间没有通道；代理只应答状态请求。

**发出专门的集成事件而不是 `skills/change`。** 页面已经会在 `skills/change` 时重新列出，而一个完成的连接器确实会改变其服务商贡献的技能；第二个事件只会为同一次刷新增加一个转发名称。

## 后果

- 服务商返回 Aeven API 后的 `consentPollMs` 内连接器即会开启，无论设置页是否打开。
- 授权待定期间，Host 每个间隔为每个待定授权发送一次状态请求，最长持续该授权的 `consentLifetimeMs`。
- 授权失败时虽然没有技能变化，也会发出 `skills/change`，使其他技能观察者各重新读取一次目录。
- 该监视通过了类型检查，但未在此处针对 Aeven API 实际运行。
