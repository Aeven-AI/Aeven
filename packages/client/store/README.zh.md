---
description: "具有显式快照、订阅与生命周期所有权的浏览器可观察状态 store。"
kind: "package-library"
---
# @aeven/client-store

[English](README.md) | 中文

## 概述

供 Client controller 与 renderer adapter 共用的不依赖 React 的 observable 和 snapshot-store 基础设施。本包负责同步与 animation-frame 发布、基于 Immer 的更新、浅比较，以及可选的浏览器持久化——整份状态或声明出的持久字段；React hook 的构造仍属于 `@aeven/client-ui-renderer`。当 Client 状态必须在不依赖 React 的情况下发布稳定 snapshot 时，请使用它。`createReadCache` 是与之独立、由插件按自身 key 包装远程读取的读穿透缓存：`peek` 把最后一次被接受的结果交给重新挂载的界面，使其先绘制并在后台重新校验，而不是再次显示加载状态；`read` 对同一 key 只保留一个进行中的读取；`invalidate` 丢弃已被写入改动的 key。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包提供浏览器侧状态基础设施，不注册任何面向模型的内容。

#### KV Cache 影响

无；这些 store 既不组装也不发送模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **持久化仅限浏览器本地**——持久化 store 使用 `localStorage` 中的 JSON；非浏览器运行时会禁用持久化，本包也不提供跨设备同步。
- **持久字段只做一层校验**——`persist.fields` 中声明的字段，仅当存储值非 null 且与初始值的 `typeof` 一致时才会回填；其嵌套内容按存储原样信任。


<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只导出库引擎，不创建进程级状态；每个 store 实例由其所属测试覆盖。
