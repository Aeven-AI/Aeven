# Agent Note：Host 的控制台只承载 Host 自己写下的内容

Status: implemented

[English](2026-08-29-host-console-is-the-hosts.md) | 中文

## Problem

`avn web` 在打印自己的第一行之前先输出了八行，没有一行来自 Host：

```
npm warn Unknown env config "manage-package-manager-versions". ...
(node:38214) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
chrome-devtools-mcp exposes content of the browser instance to the MCP clients ...
[chrome-devtools-mcp] The connecting client did not negotiate the MCP roots capability. ...
avn web: http://127.0.0.1:3080/?token=...
```

它们出自两个彼此独立的来源。

**stdio MCP 服务器的 stderr 被继承。** SDK 以 `stdio: ['pipe', 'pipe', params.stderr ?? 'inherit']` 派生子进程，而 `createTransport` 未传 `stderr`，于是每个已配置的服务器都写入 Host 的文件描述符。横幅是服务器自己的；`npm warn` 那行来自 exec 它的 `npx` —— 这正是为何在看不到任何 `npx` 的情况下它仍会出现。Host 既未撰写也未排版的输出，与它自己的输出交错抵达；一个仅仅话多的服务器，与一个正在报告故障的服务器无从分辨。

**为检测 `localStorage` 是否存在而读取它，恰恰就是宣告它的动作。** `attachPersistence` 以 `typeof localStorage === 'undefined'` 作为守卫，其注释称非浏览器运行没有该全局对象。Node 有：一个在 Web Storage 关闭时发出警告、随后返回 `undefined` 的访问器。守卫得出了正确判断，并在通往该判断的途中打印了一条 Node 警告 —— 每次 Host 启动一次。

## Decision

**stdio 服务器以 `stderr: 'pipe'` 派生，每一条完整行以该服务器的标签在 debug 级别记录。** 这些行是关于子进程的诊断信息，正是 logger 的用途；控制台属于 Host。`forwardDiagnostics` 会缓冲在行中途结束的 chunk，直到补全它的换行到达，因此一行绝不会被拆成两条记录；并在服务器写下不带结尾换行的最后一行时将其冲出。

**在读取全局对象之前，先询问运行时它拥有何种存储。** `webStorage()` 在浏览器中从 `window` 作答，在 Host 上只读取自有数据属性 —— 也就是测试通过 `vi.stubGlobal` 安装的那种 —— 因此 Node 的访问器从未被调用。读取描述符不会运行 getter，这正是该检查保持静默的原因。

## Testing

`avn web --no-open --port 3199` 现在只打印一行，且是它自己的。转发有两处覆盖：一处经由真实派生的进程，其 stderr 含一个空行与一个未终止的末行；另一处经由插件生命周期，断言服务器的某行以其标签抵达 `ctx.logger.debug`，并断言行中途的 chunk 在补全之前不会出现。store 的浏览器分支由打桩的 `window` 覆盖，其 Host 分支由既有套件覆盖 —— 该套件本就不带 `window` 运行。

`apply.spec.ts` 与 `reconnect.spec.ts` 中的 SDK 替身现在会暴露可读的 `stderr`，正如它们所替代的 transport 在 `stderr: 'pipe'` 下所做的那样。

## Alternatives considered

**以 warn 或 info 级别记录服务器 stderr。** 否决：其中多数只是问候。把横幅当作警告上报，会训练读者跳过真正故障所在的级别；而连接路径本就以自己的信息上报失败。

**在 `avn` bin 脚本中传入 `--no-webstorage`。** 否决：它只为一个启动方消除症状，其余每个入口以及任何嵌入 client 树的场景仍会收到同一条警告；并且该 flag 并非在受支持的全部 engines 范围内都可用。

**只要没有 `window` 就关闭持久化。** 依实测否决：store 自身的套件在 Node 上运行并通过 `vi.stubGlobal` 安装 Web Storage，因此仅凭 `window` 判断会关掉那些用例本就要检验的持久化。

## Consequences

MCP 服务器的 stderr 默认不再可见。它只差一个 `debug` 级别，且带有该服务器自己的标签 —— 这比它此前与无关输出交错、且不归属于任何来源的状态要多。

store 在浏览器中、以及任何将 Web Storage 安装为自有属性之处持久化，除此之外均不持久化。即便某天 Host 以 `--localstorage-file` 运行，也仍不会经由它持久化；没有消费者提出该需求，而 client store 的持久状态归属于 session log，而非 Host 的磁盘。
