---
description: "avn Web 客户端的侧边栏外壳插件：品牌行、New Session 操作、折叠控件、可感知滚动的区域席位与底部固定的 Settings 席位。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar

[English](README.md) | 中文

## 概述

`avn-client-ui-sidebar` 为 avn Web 客户端提供 Aeven 风格的导航菜单：整行 hamburger、New Session 操作、Workspace 与 Session 浏览器，以及底部固定的 Settings 席位。收起菜单会让其布局栏回到零宽度，只在左上角保留 hamburger。渲染到 `sidebar.workspaces` 的 Workspace 与 Session 浏览器归 ui-workspace 所有；本包既不派生其中的行，也不持有其视图偏好。New Session 会针对显式指定、当前或最近活跃的 Workspace 启动运行时的页面局部前端 Session Intent。

展开面板使用 Aeven 的 280px 宽度、半透明白色表面、20px 外侧圆角、40px 行高、响应式行内边距、底部内边距和 400ms easing 变量。菜单开关使用参考 hamburger 与双左箭头字形；功能操作与状态图标保持不变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

侧边栏是导航外壳：用户从 hamburger 打开它、启动新会话、浏览工作并到达 Settings。功能插件填充它的席位——ui-workspace 填充 `sidebar.workspaces`，ui-settings 在 `sidebar.settings` 注册触发行与设置面板。

### 菜单与 New Session

hamburger 行横跨整个面板，其前导字形在桌面端距离边缘 24px，在小屏端距离边缘 16px。内建 Aeven 呈现会隐藏可替换的 `sidebar.brand.mark` 与 `sidebar.brand.name` 席位。New Session 优先使用作用域操作明确指定的 Workspace，否则使用当前 Session 所属 Workspace，再否则使用最近活跃 Workspace；一个 Workspace 都没有时则清空选择，进入空白 New Session 页面。

### 折叠行为

实时收起时，面板宽度与内容透明度使用 Aeven 的 `cubic-bezier(0.23, 1, 0.32, 1)` 曲线在 400ms 内完成变化。布局栏最终为零宽度；New Session、workspace 控件与行、页脚操作和 Settings 全部隐藏，只有 68×40px hamburger 按钮固定保留在左上角。减少动态效果模式会禁用这些过渡。

### 滚动条

栏内的滚动条是一种指针可供性：只要指针不在栏内，外壳就把滚动条间接层重新绑定为 `transparent`；指针离开后滑块再保留 2 秒，因此没人指向的列表不会显示滑块。滚动区域不预留 gutter；没有溢出时，行会保留参考菜单的完整 280px 宽度。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

外壳是纯组合：`SidebarRootComponentProps` 组合布局 owner share、全局 `useSessions` 与 `useWorkspaces` 钩子、已声明的品牌、`sidebar.workspaces` 与 `sidebar.settings` 子 slot，以及注入的 `startSession` 与侧边栏切换回调。这里没有插件 store。

### Slot 纪律

声明感知的 `slots.inject()` 让替换包无论先于还是后于侧边栏激活都能生效。页脚承载 `sidebar.settings` 席位：侧边栏只渲染固定在底部的布局 slot，并共享其栏状态（`wide`）。`/client` 导出接口只包含插件主体（`apply`/`inject`）及约定类型；SidebarRoot、行组件与树派生仍由 slot 注册封装在包内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖填充外壳席位的各个界面与组合模型。

- [ui-workspace](../ui-workspace/README.zh.md)——渲染到 `sidebar.workspaces` 的 Workspace 与 Session 浏览器。
- [ui-settings](../ui-settings/README.zh.md)——在 `sidebar.settings` 注册触发行与设置面板的设置领域底座。
- [ui-layout](../ui-layout/README.zh.md)——折叠所使用零宽度栏状态的布局 owner。
- [ui-theme](../ui-theme/README.zh.md)——外壳所重新绑定的滚动条 token 间接层。
- [slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)——席位背后的组合模型。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义外壳拥有什么、其占位方拥有什么；它们是当前包约束。

- **Session 状态点渲染由 ui-workspace 持有**：本外壳没有可用的 done/error 通知数据源。
- **Workspace 浏览行为由组合持有**：分组、排序、搜索与行状态都属于 ui-workspace，不属于此外壳。
- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是从标准 `useSessions` delivery 直接派生行的纯消费插件，不发出 Cordis 事件，也不持有跨插件可变状态。
