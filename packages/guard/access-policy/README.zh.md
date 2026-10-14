---
description: "会话访问模式禁止副作用时，拒绝绕过文件系统沙箱的生效类工具；面向需要只读会话真正生效的使用者与维护者。"
kind: "package-reference"
---

# @aeven/tool-call-access-policy

[English](README.md) | 中文

## Summary

`read-only` 会话仍然存在通往副作用的路径。文件系统沙箱会拒绝所有经由 fs 能力写入的操作，因此 `write` 与 `edit` 会失败——但点击实时页面、向其输入、运行终端命令或启停设备的工具根本不会到达该层。`avn-tool-call-access-policy` 关闭这些路径：它注册一个单调的 `tools.guard()` 检查，在会话解析出的访问模式等于被禁止的模式时拒绝所列工具。拒绝信息会指明工具、模式以及授权方式，因此模型会去询问而不是重试。它随 `avn` 基础 bundle 默认启用，被禁止的模式为 `read-only`。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

常见情形只需一行：把插件加入组合——`avn` 基础 bundle 已经包含它。结果由用户通过会话的访问模式控制，而不是通过插件配置。

### When to choose it

当会话的访问模式必须对文件系统沙箱看不到的副作用生效时选择它，这正是让“只看不动”成为可执行约束而非建议的原因。当所有路径都必须保持开放时不要选择它，并记住它做不到的事：它无法拒绝没有可观测触发条件的偏好，且当会话模式为宽松模式时它不执行任何限制。

### Setting it up

使用默认值挂载：

```yaml
- name: '@aeven/tool-call-access-policy'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mode` | `read-only` | 所列工具被拒绝时对应的访问模式 |
| `deny` | 浏览器、终端与设备工具 | 模式匹配时被拒绝的工具名 |

可在 `cordis.yml` 中收窄或扩展 `deny`；空列表会停用该策略，这是明确的部署选择而非隐式默认。访问模式本身来自会话（`ctx.sandboxPolicy.resolve()`），因此同一份部署可同时服务工作会话与只读会话。

### What you get

当模式为 `read-only` 时，调用列出的任一工具都会返回一条错误结果，指明工具、模式与授权动作；工具不会执行。在 `workspace-write` 或 `danger-full-access` 下，同一调用原样运行，未列出的工具亦然。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **在动作可见处执行。** 该检查是一个 `ctx.tools.guard()` 注册，它在派发前看到工具名、参数与 agent 作用域，并通过返回原因拒绝。它完全不读取模型文本。
- **与文件系统策略叠加，而不是取代它。** `read-only` 已经在结构上拒绝文件变更。该插件覆盖从不触及 fs 能力的路径，这正是工具层检查所填补的空缺。
- **开关归用户所有。** 模式是用户设置的会话状态；工具清单是部署配置。被召回的长期记忆触及不到二者，因此学到的文本无法扩大权限。
- **零成本检查。** 该守卫是对已解析策略的同步集合查找：没有提供方调用、没有提示文本、没有 token。

### How a call is denied

每次派发都会运行一次 `tools.guard()` 回调。当工具不在 `deny` 中时返回 `undefined`（放行），当 `ctx.sandboxPolicy.resolve().mode` 与配置的 `mode` 不同时同样返回 `undefined`。否则返回原因字符串，注册表据此生成面向模型的拒绝信息。注册是 `ctx.effect` 下的副作用，因此停止或更新插件会移除该检查。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、守卫注册及其默认工具清单 |
| — | 不发布运行时 invariant 伴随文件；除其释放的守卫注册外，该插件不拥有包内历史或可变关系。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md) — 本插件注册所依赖的 guard 与 pre-execute 接缝。
- [文件系统沙箱](../../fs/fs-sandbox/README.zh.md) — 不区分路径来源而拒绝变更的那一层。
- [guard 组地图](../README.zh.md) — 同组守卫包与循环卫生系列。

-----

<a id="model-experience"></a>
## Model Experience

### Denied tool result

#### What the model sees

没有提示与 schema。被拒绝的调用返回一条错误结果：`<tool> acts outside the filesystem sandbox, which this session's "<mode>" access mode forbids; ask the user to raise the access mode to continue`。其他调用原样通过。

#### Token effect

模式宽松时为零 token。一次拒绝会新增一条很小的错误结果，并替换该工具原本会产生的输出。

#### KV Cache effect

仅追加；拒绝是新的尾部内容，不会使既有缓存条目失效。

## Known Limitations and Deferred Work

- **仅在模式已设置时生效** — 在 `workspace-write` 或 `danger-full-access` 下该检查放行一切；从未更改模式的会话，除文件系统策略外没有额外保护。
- **仅限可观测规则** — 在结构化状态中没有触发条件的偏好（“简洁些”、“不要过度设计”）无法表达为守卫。
- **这是拒绝清单，而非允许清单** — 清单未命名的插件新工具会被放行；需要反向语义的部署应把允许的工具之外的一切列入 `deny`。
