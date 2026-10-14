# Agent Note: 记录表属于开发者界面

Status: implemented

[English](2026-10-08-trajectory-behind-developer-mode.md) | 中文

## 问题

客户端有两处界面把 trajectory 记录表当作日常机制呈现。每个工具行都带有一个 hover 才显示的 `Inspect` 胶囊（通用行、bash 示例、skill 行，以及 ui-cordis 的三个行），Conversation View 的 owner share 还带有一个一次性焦点请求（`viewRequest`/`openView`/`completeViewRequest`），其唯一生产者就是这个胶囊：它打开记录表并把请求的调用滚动到视野中。对任何阅读对话的人来说，该胶囊都是噪声；而记录表本身——请求头、原始工具 schema、逐请求 token 记账——是给构建 Æven 的人看的界面，不是给他们运行的会话看的。

## 决定

- **仅在开发者模式开启时挂载记录表。** `ui-trajectory` 绑定 `ui-developer` 设置分段（属于 `ui-settings-general` 的命名空间，本包只导入其类型），并把它的 View entry、Conversation Definition 与会话 `trajectory` 钩子作为单个子插件挂载；关闭该设置会一并释放它们。因此普通会话的 View 名单永远不会列出 Trajectory，而之前保存的 `trajectory` 视图偏好会经由既有的 `resolveActiveView` 阶梯回落到 Chat。
- **Inspect 入口已移除。** `ToolCallOwnerProps` 不再带有 `inspect`，ui-chat 不再向 keyed Chat renderer 提供 `inspectCall`，`ui-tool`（通用行、bash 行）、`ui-skill` 与 `ui-cordis`（define、run、stop/remove）中的胶囊位置不再渲染任何内容。
- **跨视图焦点请求随其生产者一同移除。** `ConvViewOwnerProps` 不再声明任何 owner 取值，Conversation store 只保留草稿与所选 View，记录表也不再解析外部请求的调用。等出现真正的生产者时再恢复该通道。

## 备选方案

**保留 `inspect`/`inspectCall` 接缝，只删除按钮。** 这些回调在任何已发布组合中都将没有调用方：一个为了让假想的第二个消费者使用而保留的公开透传，这违反包规则（“要求当前所有者与需求”）。若日后出现生产者，恢复整套接缝的成本很低。

**隐藏 View entry，其余部分继续挂载。** 增加一个类似 `visible` 的注册选项会让 Conversation Definition、记录表的会话钩子与其字典留在隐藏标签页之后继续存活——这是增加界面而非减少，而且没有其他 View 需要该选项。

**在 `ui-settings-general` 中新增 `developerMode` 客户端服务。** 服务是跨包的正当方式，但开发者模式只是一个布尔值，读取它的插件还必须能在没有设置文档时工作；直接绑定设置分段让读取保持局部，而 `ui-settings-general` 的 README 已经记载了这一消费者模式。

**在释放读者正在查看的记录表之前先询问。** 关闭该设置时，受影响的会话已通过视图偏好回落切换到 Chat，而开发者模式是操作者本人的刻意动作；确认对话框只会为其刚刚选择离开的状态加一道防线。

## 影响

- 未开启开发者模式时无法访问记录表，因此 trajectory 的 e2e 场景以及捕获了 View 行或 `Inspect` 胶囊的 golden 必须在自己的测试环境中开启开发者模式（在播种的 `settings.yaml` 中加入 `ui-developer:` 段），或重新录制。
- 从对话中直接阅读某个调用不再是一键操作：读者需切换到记录表并在其中找到该记录。作为交换，每个工具行少了一个与其内容竞争的控件，四个包少了一个只用于转发滚动目标的 prop。
- `ui-trajectory` 现在为类型依赖 `@aeven/client-ui-settings-general` 与 `@aeven/client-ui-settings`，并注入 `settingsScope`；没有设置文档的组合不会挂载记录表。
- 客户端 slot 目录（`cordis_inspect what:"client"`）已随精简后的 owner share 重新生成，因此动态 Plugin 作者读到的是当前约定。
- 移除胶囊部分取代了[Web 工具行统一展开交互与 trajectory Inspect](../feature/2026-07-30-web-tool-row-unified-expand-and-inspect.zh.md)：该笔记保留统一展开交互，并在此指向上文以说明已删除的 Inspect 部分。
