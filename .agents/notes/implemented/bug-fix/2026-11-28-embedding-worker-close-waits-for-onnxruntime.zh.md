# Agent Note: 嵌入工作线程在其运行中的请求结束后才关闭

Status: implemented

[English](2026-11-28-embedding-worker-close-waits-for-onnxruntime.md) | 中文

## 问题

`avn web` 在启动后的最初几秒内被停止时，可能以 `SIGABRT` 结束，而不是返回其退出码。macOS 崩溃报告把中止定位在 `onnxruntime_binding.node` 内的一个工作线程：`Napi::Error::ThrowAsJavaScriptException` 失败，`libc++abi` 终止了进程。`@aeven/memory-memos` 在提供方启动时就把本地嵌入模型加载进 Host 的嵌入工作线程（`HostedEmbeddings.warm`）。停止提供方时会立即调用 `worker.terminate()`。当终止在 onnxruntime 调用期间到达工作线程时，onnxruntime 会把错误抛进一个已在停止的 JavaScript 环境，node-addon-api 将其变成未捕获的 C++ 异常，使整个进程中止，而不只是工作线程。

一个直接复现——启动预热并在固定延迟后关闭 `HostedEmbeddings`——在 140 到 330 毫秒之间的 20 次运行中中止了 9 次，在 160 到 240 毫秒之间每次都中止。在构建后的 CLI 上，启动期间发送 SIGTERM 的 10 次运行中有 1 次中止。`web-browser-open` 的预期快照因同一原因记录到 `exitCode: undefined`。

## 决策

`HostedEmbeddings.close()` 以 `Hosted embeddings are shutting down` 拒绝每个排队中的请求，拒绝在它开始之后发起的请求，并等待工作线程正在运行的请求结束后才调用 `worker.terminate()`。当工作线程给出应答、或报告错误、或退出时，运行中的请求即告结束，因此在等待期间死掉的工作线程不会卡住 `close()`。等待只持续这一个请求：一次模型加载或一个嵌入批次。CLI 的进程关闭仍会在其 5 秒宽限期后强制退出，因此比这更长的请求会像以前一样结束。

`web-browser-open` 测试夹具通过向自身进程发送一次 SIGTERM（即监管程序发送的停止信号）来停止 `avn web`，而不是调用 `process.exit(0)`。单独的 `process.exit` 会跳过应用的释放，并在调用中途结束工作线程，任何提供方的拆除都无法让这种情况变得安全。

修改后，直接复现在 0 到 1500 毫秒之间完成了 26 次关闭，全部没有中止，每次最多耗时 810 毫秒。构建后的 CLI 在 1.0 到 2.0 秒之间的 21 次 SIGTERM 停止和 5 次 SIGINT 停止中全部正常退出，`web-browser-open` 以其记录的 `exitCode: 0` 通过。`tests/hosted-embeddings.spec.ts` 用替身工作线程覆盖关闭顺序，其四个用例中有两个在之前的 `close()` 上失败。

## Alternatives considered

- **向工作线程发送协作式关闭消息。** 本次未采用：Host 已经知道工作线程正在运行哪个请求，因此等待它无需修改协议。工作线程也无法释放模型，因为 vendored 的 `LocalEmbeddingProvider` 把 transformers pipeline 保存在模块状态中，其 `close()` 不做任何事。
- **在终止前释放 onnxruntime 会话。** 未采用，因为这需要对 `vendor/memos-local-plugin` 做一项需记录的本地修改，而等待运行中的请求已经消除了中止。
- **设置关闭超时并回退到 `terminate()`。** 未采用：回退会让最长的请求重新出现中止，而 CLI 的进程级宽限期已经为关闭设了上限。
- **保留夹具中的 `process.exit(0)`，只修改预期输出。** 未采用，因为这会把崩溃记录为预期行为。

## Consequences

在启动期间停止 `avn web` 或托管应用不再使进程中止，代价是关闭要等待正在进行的模型加载或嵌入批次，在实测主机上最长约一秒。强制退出（例如第二个信号或 5 秒宽限期耗尽）仍会在调用中途终止工作线程，仍可能中止。自行加载模型的核心工作线程仍会被直接终止。这只在 `coreWorkers` 大于 `0` 且 `embeddingExecution: host` 时发生，没有任何随附组合使用这种配置，包的 README 已将其列入已知限制。
