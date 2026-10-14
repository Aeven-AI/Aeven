---
description: "Web GUI 的右侧边栏：ui-layout 预留的每会话一栏、其头部开关与面板内收起控件，以及每个会话各自记住的宽度拖动；供右侧面板的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-right

[English](README.md) | 中文

## 概述

本包占据 Web GUI 布局的 `rightbar` 栏：每个会话都能从会话头部打开或关闭自己的面板，在面板内再次收起它，并拖动该栏的内侧边缘在 300px 与框架宽度 70% 之间调整大小，首次打开时为框架宽度的 45%。面板跟着会话走，因此切换会话会按该会话上次留下的宽度重绘这一栏。在内容包注册到 `sidebar.right.body` 槽位之前，其主体为空；而面板表面、开关与拖动手柄在任何此类包出现之前就都已可用。

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

把本插件作为客户端组合的一行挂载；Web 应用组合包已经把它作为 `ui-sidebar-right` 携带，排在 `ui-sidebar` 行之后。打开会话后，会话区右上角的导航带里会出现一个打开面板控件，位于账户头像之前；点击它打开该栏，再次点击关闭。在已打开的面板内，面板上缘的收起控件会把这一栏折起，栏内侧边缘上的拖动手柄则调整它的大小。

### 打开、关闭与调整大小

这一座位是 root 作用域的，因此头部控件从全局会话列表读取当前会话，在没有当前会话时不绘制任何内容。在拖动手柄上按下指针会冻结手势开始时的宽度，并把每一次上报都夹进框架允许的范围；store 保存的是夹取后的宽度，所以拖动无法关闭它正在调整的面板。关闭会为该会话保留这个宽度，因此重新打开时回到读者上次留下的宽度，而不是首次打开的比例。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`apply` 注册 `sidebarRight` 语言命名空间，把 `SidebarRightRoot` 注册到框架的 `rightbar` 座位并在其下声明 `sidebar.right.body` 子槽位，同时把一个开关注入 `conversation.navigation.utilities`，order 为 90，位于账户头像的 order 100 之前。注入钩子会为会话作用域的座位收到会话 id 并闭包捕获它，因此面板自己的控件切换的正是该座位所属的会话。

几何由框架持有。`SidebarRightRoot` 不声明自己的宽度：它读取 `--avn-frame-rightbar-width`（ui-layout 从其 store 写入的自定义属性），并在 `.visible` 时据此解出展开宽度；因此拖动只是一次纯 CSS 写入，永不使文本记录的样式失效。折叠是唯一的 `.visible` 状态，所以外壳不重新定位也不重新挂载任何东西，面板会继续绘制自己的表面，即使主体尚无占位方。

ui-layout 在其布局 store 中保存每个会话的表面：`shown` 外加一个记住的 `width`，首次打开时以框架宽度的 45% 播种，每次写入都夹进 300px 下限与 70% 上限。框架解出当前会话的表面来安放这一栏，把宽度读进上面那个属性，并且只在宽度大于零时绘制 rightbar 拖动手柄。这份状态只存在于内存中，因此重新加载后每个会话都从关闭状态开始。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当这一栏的行为不够用时、或你要构建的正是面板主体时，阅读以下页面。它们从这一栏所处的框架走向组装出该外壳的那些包。

- [ui-layout](../ui-layout/README.zh.md)——持有 `rightbar` 栏、每会话宽度，以及本面板借以调整大小的拖动手柄。
- [ui-conversation](../ui-conversation/README.zh.md)——渲染导航带与打开面板控件所在的会话头部。
- [ui-sidebar](../ui-sidebar/README.zh.md)——本外壳所镜像的左侧边栏，折叠与调整大小的行为亦然。
- [ui-primitives](../ui-primitives/README.zh.md)——提供面板与箭头字形，以及控件据以加标签的 tooltip。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该面板是布局栏之上的浏览器端表面，不注册任何 prompt、工具或结果。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本外壳目前发布的内容。它们是当前包约束，不是通用面板功能对比。

- **主体槽位尚无已注册的占位方**——`sidebar.right.body` 已声明并已渲染，但没有任何东西注册到它，因此面板在空主体之上绘制自己的表面、控件与拖动手柄。
- **`tests/` 为空**——折叠开关、头部开关，以及与框架宽度之间的集成，都没有本包自己的 spec 覆盖；它们只经 ui-layout 与 ui-sidebar 各自的测试套件被间接覆盖。
- **面板宽度不跨重新加载保留**——每会话表面只存在于内存中，因此重新加载后每个会话都以关闭状态打开，也没有记住的宽度。
- **面板内容不归本包所有**——外壳既不枚举也不校验主体占位方绘制什么；该座位是单条目且按会话的，第二次注册会替换第一次。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是纯消费插件，其 `collapsed` 与 `width` 派生自框架在 `rightbar` 座位交付的 props；它不发出 Cordis 事件，也不持有跨插件可变状态。
