# Agent Note: 脚本运行器与命令运行器

Status: implemented

[English](2026-09-21-macos-provider-script-runners.md) | 中文

## Problem

`@aeven/computer-use-macos-provider` 负责装配 macOS 技术栈，而它的构造函数只构建了一个运行器——`createMacCommandRunner()`——随后把这同一个对象交给了两个消费者。两者回答的是不同的问题。桌面适配器驱动的是*程序*：它通过 `execFile(command, args)` 启动辅助功能遍历与就绪探测。Apple 事件处理程序运行的则是*脚本*：它通过 `osascript -l <language> -e <script>` 求值文本，JavaScript 机制调用 `runner.run(script)`，而那唯一的 AppleScript 机制调用 `runner.run(script, 'AppleScript')`。

拿到命令运行器后，这两种调用都无法工作，而且失败方式各不相同，因为 `createMacCommandRunner` 会把它的第二个参数展开进 argv。JavaScript 路径根本不传第二个参数，于是 `[...undefined]` 抛出 `TypeError`，被该运行器捕获后报告为退出码 1，并以该类型错误作为诊断信息。AppleScript 路径则把语言字符串展开成十一个单字符参数，于是 `execFile` 会去寻找一个以脚本文本命名的程序，并报告 ENOENT。两种症状读起来都像机制本身坏了——脚本不可用，或者缺少某个工具——而不像一条接错的接缝；这正是值得记录下来的原因：症状把矛头指向配方与运行环境，而故障在三行之上的提供程序里。

这个错误对编译器并不隐晦：`MacCommandRunner` 不能赋给 `AppleEventsRunner`，因为接受 `(command, args, signal)` 的 `run` 无法顶替接受 `(script, language)` 的那个。写下这处接线时，该包只存在于工作区中——`packages/computer-use/computer-use-macos-provider/` 未被跟踪，它的两处聚合条目（`tsconfig.base.json` 的路径别名与 `tsconfig.host.json` 的项目引用）同样未被提交——因此没有任何门禁编译过它；`tsc -b tsconfig.host.json` 第一次针对该工作区运行时，就以指名参数的方式拒绝了它。

## Decision

提供程序为每一类各构建一个运行器，并把它们分别交给与其契约相符的消费者：`createMacCommandRunner()` 交给 `MacDesktopAdapter`，`createOsascriptRunner()` 交给 `TaskExecutor` 与 `ComputerUseSession` 共同接收的 `apple-events` 处理程序。

两个工厂都保持导出，而接缝是它们各自返回的函数类型，而不是调用点：Apple 事件处理程序接受 `AppleEventsRunner`，桌面适配器接受 `MacCommandRunner`，因此部署方可以注入自己的传输实现——测试中的录制运行器、托管部署中的远程执行器——而提供程序无需知道拿到的是哪一个。提供程序是唯一同时导入两者的包，这正是它之所以是提供程序、而不是塞进任一适配器里的更多代码的原因。

钉住这处接线的是 `tsc`，而且只有它。两个运行器都是带有 `run` 方法的对象，且都把非零退出解析为值而不是拒绝，因此在传输被替换为桩之后，机制处理程序自身的测试用其中任何一个安装都能通过。

## Alternatives considered

**用一个运行器自行推断形态。** 让单个 `run` 的第二个参数要么是语言标签、要么是 argv 数组，就能让提供程序那一次构造变成合法写法。已否决：这种歧义恰恰是让接线错误隐形的根源，因为那样一来每个调用点都要携带本可由类型陈述的知识，而错误调用会到第一个 Apple 事件时才失败，而不是在编译期。

**按消费者给工厂命名。** 用 `createAppleEventsRunner` 搭配 `createAdapterRunner`，会让错误的配对在调用点读起来就是错的。已否决，因为运行器并不是消费者：`osascript` 运行器可服务任何"运行脚本"的接缝，而以今天的唯一调用者命名的名字，会在第二个调用者出现的那天必须改动——何况返回类型已经把两者区分开了。

## Consequences

Apple 事件机制如今能够抵达其传输，因此那些断言应用状态的语义配方——日历中存在某个事件、某条笔记存在——可以运行，而[提供程序测试](../../../../packages/computer-use/computer-use-macos-provider/tests/provider.spec.ts)直接覆盖了两个工厂：失败脚本以状态值解析而不是抛出，成功脚本返回其 stdout。

代价是每个提供程序实例多出一个 `promisify(execFile)` 闭包，而这并不值得避免：适配器与处理程序确实需要不同的 argv 形态，而运行器类型正是陈述这一差异的地方。希望两者共用同一传输的部署，可以注入由同一份代码支撑的两个运行器。

同一次 `tsc -b tsconfig.host.json` 还暴露了本批次的第二个缺陷，位于 [`resolveExpectations`](../../../../packages/computer-use/computer-use-executor/src/expectations.ts)：它在可选期望字段上写入 `undefined`，违反了 `exactOptionalPropertyTypes`。那一处修复自身不承载任何决策：消费者通过 `=== undefined` 读取这些字段，而 JSON 序列化在两种写法下都会丢弃值为 undefined 的属性，因此解析后的期望现在就是它被声明时的形状，而不是代码恰好构建出的形状。
