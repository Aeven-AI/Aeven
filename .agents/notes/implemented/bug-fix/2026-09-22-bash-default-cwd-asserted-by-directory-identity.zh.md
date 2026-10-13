# Agent Note: Bash 默认 cwd 按目录身份断言

Status: implemented

[English](2026-09-22-bash-default-cwd-asserted-by-directory-identity.md) | 中文

## Problem

`packages/shell/bash-local/tests/executor.spec.ts` 断言 shell 的默认工作目录等于进程自身的工作目录，且以路径文本断言：`expect(result.stdout.text.trim()).toBe(process.cwd())`。

`pwd` 打印的是逻辑路径——当继承来的 `PWD` 与 `getcwd(3)` 指向同一目录时 bash 会保留它——而 `process.cwd()` 是物理路径。在不区分大小写的文件系统上，经由大小写不同的拼写进入 checkout 会让这两个字符串仅大小写不同却指向同一目录，于是用例在执行器行为正确时也会确定性失败：`expected '/Users/Mac/Projects/Nodejs/aeven/aeven' to be '/Users/Mac/Projects/Nodejs/Aeven/aeven'`。

`fs.realpathSync` 修不了这一点：它解析的是符号链接而不是大小写，会原样返回传入的拼写。两种拼写 stat 出来都是设备 `16777234`、inode `173691567`。

## Decision

用例改为断言两个路径所指的目录本身：对 shell 的 `pwd` 输出与 `process.cwd()` 分别 stat，然后比较 `dev` 与 `ino`。

```ts ignore-check
expect({ dev: shellCwd.dev, ino: shellCwd.ino }).toEqual({ dev: processCwd.dev, ino: processCwd.ino })
```

产品侧没有变化。继承父进程环境（含 `PWD`）对子进程而言是正确的，POSIX shell 也有权打印逻辑路径；分歧在断言，而不在执行器。

## Alternatives considered

**在 macOS 上跳过该用例。** 否决：拼写分歧恰恰出现在这个平台，而跳过的用例对执行器的默认工作目录不作任何断言。

**放宽为子串或 basename 匹配。** 否决：任何名为 `aeven` 的目录都共享该 basename，默认目录错误时用例仍会通过。

**在运行前改写 `process.env.PWD`。** 否决：这抹掉了正要考察的条件，即执行器实际拿到的是哪个路径。

**经 `fs.realpathSync` 比较。** 否决：realpath 在此不规范化大小写，差异在规范化之后依然存在。

## Consequences

- 用例保留了它本来的主张——shell 默认使用进程的工作目录——并在两种拼写下都成立，在不区分大小写与区分大小写的文件系统上同样成立。
- 该比较并非空转：把期望指向 `/tmp` 时，用例在同一设备上报告 inode `175817587` 与 checkout 的 `173691567`，因此默认目录指向别处仍然会让用例失败。
- 两个目录都必须存在，因此默认指向不存在的目录会由 `statSync` 的 `ENOENT` 失败，而不是文本不匹配。
- 已在两种拼写下（`/Users/Mac/Projects/Nodejs/Aeven/aeven` 与 `/Users/Mac/Projects/Nodejs/aeven/aeven`）各验证聚焦用例通过，并验证整文件一次运行通过。
