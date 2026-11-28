# Agent Note: Close the embedding worker only after its running request settles

Status: implemented

English | [中文](2026-11-28-embedding-worker-close-waits-for-onnxruntime.zh.md)

## Problem

`avn web` could end with `SIGABRT` instead of its exit code when it was stopped during the first seconds after start. The macOS crash report places the abort in a worker thread inside `onnxruntime_binding.node`: `Napi::Error::ThrowAsJavaScriptException` fails and `libc++abi` terminates the process. `@aeven/memory-memos` loads the local embedding model in the Host's embedding worker as soon as the provider starts (`HostedEmbeddings.warm`). Stopping the provider called `worker.terminate()` at once. When termination reached the worker during an onnxruntime call, onnxruntime raised its error into a JavaScript environment that was already stopping, and node-addon-api turned that into an uncaught C++ exception that aborts the whole process, not only the worker.

A direct reproduction that starts the warm-up and closes `HostedEmbeddings` after a fixed delay aborted 9 of 20 runs between 140 and 330 ms, and every run between 160 and 240 ms. On the built CLI, SIGTERM during start-up aborted 1 of 10 runs. The `web-browser-open` expected snapshot recorded `exitCode: undefined` for the same reason.

## Decision

`HostedEmbeddings.close()` rejects every queued request with `Hosted embeddings are shutting down`, refuses requests made after it starts, and waits for the request the worker is running to settle before it calls `worker.terminate()`. The running request settles when the worker answers or when the worker reports an error or exits, so a worker that dies during the wait does not hold `close()`. Waiting lasts for that one request: a model load or one embedding batch. The CLI's process shutdown still forces exit after its 5 s grace, so a request longer than that ends as before.

The `web-browser-open` fixture stops `avn web` by sending its own process one SIGTERM, the stop a supervisor sends, instead of calling `process.exit(0)`. A bare `process.exit` skips the application's disposal and ends worker threads mid-call, which no provider teardown can make safe.

With the change, the direct reproduction completed 26 of 26 closes between 0 and 1500 ms without an abort, each taking at most 810 ms. The built CLI exited normally on 21 of 21 SIGTERM stops between 1.0 and 2.0 s and 5 of 5 SIGINT stops, and `web-browser-open` passes with its recorded `exitCode: 0`. `tests/hosted-embeddings.spec.ts` covers the shutdown order with a stand-in worker. Two of its four cases fail against the previous `close()`.

## Alternatives considered

- **A cooperative close message to the worker.** Rejected for this change: the Host already knows which request the worker runs, so waiting for it needs no protocol change. The worker cannot release the model either, because the vendored `LocalEmbeddingProvider` keeps the transformers pipeline in module state and its `close()` does nothing.
- **Release the onnxruntime session before termination.** Rejected because it requires a logged local modification of `vendor/memos-local-plugin`, and waiting for the running request already removes the abort.
- **A close timeout that falls back to `terminate()`.** Rejected: the fallback would reintroduce the abort for the longest requests, and the CLI's process-level grace already bounds shutdown.
- **Keep `process.exit(0)` in the fixture and change only the expected output.** Rejected because it records a crash as expected behavior.

## Consequences

Stopping `avn web` or the hosted app during start-up no longer aborts the process, at the cost of a shutdown that waits for the model load or embedding batch in progress, up to about a second on the measured host. A forced exit, such as a second signal or the 5 s grace running out, still terminates workers mid-call and can still abort. A core worker that loads the model itself is still terminated without waiting. That happens only with `coreWorkers` above `0` and `embeddingExecution: host`, which no shipped composition uses, and the package README lists it under its known limitations.
