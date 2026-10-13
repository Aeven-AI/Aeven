# Agent Note: 通过地址导航时展现 Session

Status: implemented

[English](2026-09-07-session-reveal-on-address.md) | 中文

## Problem

展现选中 Session 所在行的机制此前只能经由搜索触发。可寻址的会话让读者还有另外三种方式选中侧栏从未滚动到的 Session：粘贴的 `/c/<id>` 链接、后退与前进。每一种都留下同一个未回答的问题——打开的会话在 Workspace 层级中位于何处——而所属 Workspace 可能是关闭的、该行可能位于五行折叠之外，两种浏览模式也都可能把它排在滚动视口以外。

## Decision

[`WorkspaceBrowser`](../../../../packages/client/ui-workspace/README.zh.md) 改为依据当前 Session id 触发展现，而不是依据搜索这一次转换，因此每次选择都会展现其行，地址路径无需另设机制。搜索保留它额外的动作——清空查询并收起面板——因为只有搜索才有一个需要离开的过滤视图。

对每次选择都执行展现、而非只对地址到达执行，是有意为之。读者已经能看到的行不产生任何代价：展开的分组保持展开，已展开的余下部分保持展开，而 `block: 'nearest'` 只会滚动确实不在视野内的行。另一种做法则要求浏览器知道哪些选择来自地址栏。

## Alternatives considered

**把导航来源信号从 URL 策略贯通到浏览器。** 这样展现只对地址到达触发。但它为一个读者根本无法观察到的区分，在导航服务、Session 列表 store 与组件之间新增一项事实——因为展现一个已可见的行不会改变任何东西。

**只在初次挂载与 popstate 时展现。** 在运行中的客户端里粘贴地址会在这两个事件之外选中 Session。当前 Session id 用一个依赖覆盖了全部三种到达方式。

**让 URL 策略自己滚动。** 该策略并不持有行元素。拥有该 DOM 节点的行已经执行并确认滚动，第二个滚动方只会与它竞争。

## Consequences

通过任意途径选中 Session 都会展开其所属 Workspace 并把其行滚动到可见区域。读者显式收起的分组会在其中某个 Session 成为当前项时重新展开，这与搜索导航此前已有的展现行为一致。创建 Session 同样会展现它的新行。

jsdom 未实现 `scrollIntoView`，因此渲染选中 Session 行的客户端测试需要自行提供该方法。这是测试环境的缺口，而非产品侧的防御：在浏览器中每个元素都具备该方法。

## Testing

一个 `WorkspaceBrowser` 测试在不触碰搜索的情况下选中位于关闭 Workspace 折叠之后的 Session，并断言分组展开、该行挂载、且该行就是滚动目标。既有的搜索路径、baseline 未就绪、重连、取消与扁平模式展现测试继续锁定这一共享机制。
