# Agent Note: 桌面端订阅登录

Status: implemented

[English](2026-10-10-desktop-subscription-sign-in.md) | 中文

## 问题

桌面 overlay 因订阅插件依赖 `webServer` 而禁用该插件。Electron 还拒绝登录 UI 使用的空白弹窗，因此仅启用插件仍无法完成认证。

## 决策

桌面端在 `127.0.0.1` 上以操作系统分配的端口启用现有 HTTP 载体。分帧管道 Fetch 分发器只把来自 `avn-app://app` 的 `/plugins/avn-grok-build/` 请求转发到该监听器，在指定本机回环 origin 前拒绝外部 origin 与跨站 Fetch 元数据。监听器保留订阅的操作者请求检查。前端通过现有连接器 `openExternal` 桥接打开登录页及供应商链接；Web 在点击期间为浏览器流程与设备码流程打开独立标签页。现有回调、轮询、凭据持久化及模型选择实现继续负责认证。

[桌面打包决策](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)保留应用流量的分帧管道通信。订阅 HTTP 监听器是其无监听端口方案的本机例外。

## 结果

Electron 与 Web 一样在提供方设置中显示订阅卡片。本机 HTTP 载体为桌面进程生命周期增加一个回环监听器。供应商凭据保留在现有的仅操作者可读存储中。按用户要求，验证仅包括 TypeScript 编译与构建；真实供应商认证尚未验证。

## 考虑过的替代方案

**只启用卡片。** 登录、额度及模型选择请求都需要可用的 Host 路由。

**用新 RPC 端点替换订阅 HTTP 路由。** 这会重复现有路由实现，并因桌面通信缺口而改变 Web 路径。

**打开嵌入式 Electron 认证窗口。** 现有连接器桥接打开用户的默认浏览器，保留该浏览器的供应商会话并避免嵌入式浏览器限制。
