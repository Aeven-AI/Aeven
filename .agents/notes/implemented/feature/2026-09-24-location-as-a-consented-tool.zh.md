# Agent Note：作为经许可工具的位置

Status: implemented

[English](2026-09-24-location-as-a-consented-tool.md) | 中文

## 问题

被问到“这里天气如何？”或“我附近的药店”时，模型只有基于 IP 的线索，最多精确到城市，在 VPN 后还是错的。变通办法是通过 DevTools 给浏览器授予位置权限。位置是个人数据，因此不能成为每个请求都发送的环境上下文。

## 决定

位置是模型调用、由读者应答的工具：

- `@aeven/tool-location` 注册带必填 `purpose` 的 `get_location`。调用派发以代理为作用域的 `location/request` waterfall 并渲染应答：带 `accuracyMeters` 的设备坐标、输入的地点、拒绝，或带原因的不可用。`precision: approximate` 把坐标四舍五入到约一公里。等待时间是工具超时 `consentTimeoutMs`，因为转发的 waterfall 会一直挂起直到客户端应答（[有界的浏览器状态查询](../bug-fix/2026-09-24-bounded-browser-status-lookup.zh.md)）。
- `@aeven/client-ui-location` 在 Web 客户端中应答该 waterfall。浏览器的许可提示就是读者唯一的一次批准：浏览器已允许的网站不显示卡片直接读取；否则立即开始读取，并由输入区卡片**允许 Aeven 获取你的精确位置？**解释该提示，**好**再次读取，**不**只拒绝本次请求。最初的设计在浏览器提示之前先在卡片中询问，使读者需要批准两次。

waterfall 就是提供者接缝：读取 Core Location、Windows.Devices.Geolocation 或 GeoClue 的 Host 监听器可以应答同一事件，而无需改变工具或模型契约。

## 考虑过的替代方案

**在每个请求中注入位置。** 它省去一次工具调用，但会发送任务可能不需要的个人数据，并让每个请求依赖读者从未为该用途给出的许可。

**以 IP 定位作为默认应答。** 它无需许可，但声称的位置误差达数公里；它不在应答集合中，而不是被标为“你的位置”。

**先做原生操作系统提供者。** 它们避开 Electron 基于 Google 的 Chromium 定位，契合本地优先的产品，但需要逐平台代码和打包授权；浏览器路径今天服务于 Web 客户端，而接缝为它们留出了空间。

## 后果

- 模型收到坐标，因为没有能直接消费它们的地点或地理编码工具；`approximate` 精度是部署层面的控制。
- 浏览器只向安全上下文提供定位，因此通过 http 在局域网地址上的 Web 客户端会报告位置不可用。
- 在原生提供者存在之前，桌面应用可能报告位置不可用。
