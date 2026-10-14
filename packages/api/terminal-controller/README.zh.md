---
description: "临时性、会话所有用户终端的 Host Remote 拥有者，以及 sidebar_terminal 工具。"
kind: "package-reference"
---

# @aeven/api-terminal-controller

[English](README.md) | 中文

## 概述

`@aeven/api-terminal-controller` 拥有 `ctx.terminalController`，即侧栏终端背后的 Host 服务：它报告会话的工作目录与终端限制，发现执行环境提供的 shell，按调用方给出的终端 id 一次性分配 PTY，并为该会话保留、跟随、写入、调整尺寸、重命名和关闭该终端。终端以执行环境的系统用户权限运行，按会话计入 `maxTerminals`，且只有拥有该会话的账户可以访问。同一个实例在其之上注册 `sidebar_terminal` 工具，并在调用触及非 `danger-full-access` 会话的终端之前通过 `tools/pre-execute` 询问。

## 目录

- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="model-experience"></a>
## 模型体验

### 侧栏终端控制

#### 模型看到什么

工具 `sidebar_terminal` 及其 `list`、`read`、`send`、`rename`、`resize`、`close`：读取返回终端信息与有界的渲染屏幕和历史文本，其余每个动作都指名它所操作的终端 id。

#### Token 影响

只有该调用自身的结果文本：读取受 `maxToolOutputBytes` 限制，发送超过 `maxInputBytes` 会被拒绝。

#### KV Cache 影响

仅追加：结果在用户消息之后进入对话，不改变更早的请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **终端是 Host 生命期内的，而非持久的** —— 拥有者记录驻留内存，终端的任何信息都不写入 Session 日志，因此 Host 重启会连同回滚缓冲一起失去所有终端。
- **只有一个附件能发送输入** —— 输入控制是独占的，最后附接的窗口可写入，其余窗口只能读取。
- **无人值守回收需要 Provider 佐证** —— 终端在没有任何窗口持有、且确认空闲达到 `unattendedTimeoutMs` 后关闭；无法证明空闲的 Provider 会让它保持打开；取零则关闭回收。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为控制器不拥有可重放的会话事件流：所有权、每会话上限以及关闭与终止的关系都在修改它们的操作内强制执行，每个终端由其会话拥有者的 effect 释放，这些路径由真实组合的工具测试套件 `tests/tools.spec.ts` 覆盖。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
