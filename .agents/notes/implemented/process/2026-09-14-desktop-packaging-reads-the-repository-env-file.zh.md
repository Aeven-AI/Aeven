# Agent Note: Desktop packaging reads the repository `.env` file

Status: implemented

[English](2026-09-14-desktop-packaging-reads-the-repository-env-file.md) | 中文

## Problem

每个 `package:desktop:*` 命令都从 shell 读取 `AVN_DESKTOP_APP_ID`、`AVN_DESKTOP_AUTO_UPDATE_ENV` 与 `DOWNLOAD_TEST_ORIGIN`。仓库根目录专门为本机设置提供了 `.env` 文件，产品 CLI 也已在启动时加载它，因此把打包设置放在该文件中的工作站，仍然必须在打包前再次导出这些变量，并且每开一个新 shell 都要重做一次，因为该加载路径属于 CLI，而不属于打包脚本。

打包无法直接沿用产品的加载路径：package 命令只是一个普通的 pnpm 脚本，它不启动任何 Cordis 应用，因此没有任何 boot 层为它填充环境。

Linux 容器构建让这一缺口变得可见。`package-linux-container.ts` 通过 `--env` 把这三个名字转发进容器，而 shell 从未设置的名字就等于什么都没转发。

## Decision

`apps/desktop/scripts/desktop-environment-file.ts` 导出 `loadDesktopPackagingEnvironment(path, environment)`，它用 `parseEnv` 读取一个 env 文件，只把 `DESKTOP_PACKAGING_ENV_NAMES` 中的名字——`AVN_DESKTOP_APP_ID`、`AVN_DESKTOP_AUTO_UPDATE_ENV` 与 `DOWNLOAD_TEST_ORIGIN`——复制进一个尚未持有该名字的环境中。它返回已复制的名字，文件不存在时返回空列表。

`package-target.ts` 与 `package-linux-container.ts` 都在 `main` 开头用仓库根目录的 `.env` 调用它一次，因此主机打包与容器打包会从同一个文件解析同样的三项设置。`package-linux-container.ts` 的 `--env` 转发列表也来自同一个导出的 `DESKTOP_PACKAGING_ENV_NAMES` 常量，因此容器路径不可能转发一组与 loader 提供的名字发生偏移的名字集合。

这三个名字仍是完整的集合。`OPENROUTER_API_KEY`、COS secret 以及仓库根目录 `.env` 中的其他任何条目都不会进入打包子进程环境，也没有任何打包代码从那里读取它们。shell 已经设置的值优先，因此 CI 任务或一次性的覆盖仍然保有其含义，shell 仍是优先级更高的来源。

`.env` 被 git 忽略，loader 也不读取任何绝对 home 路径，因此 `.env` 只指仓库根目录的那个文件。没有该文件的 checkout 中，打包运行的行为与以前完全一致：它读取 shell，缺失的设置仍在一直以来的同一个位置失败。

## Alternatives considered

**把整个文件加载进 `process.env`。** electron-builder 及其 hook 会派生 subprocess，而产品的既定规则是键的环境值优先；用开发者 `.env` 中的每个条目填满环境，会把这些无关的密钥交给那些子进程，并掩盖这一错误。显式的名字列表就是这里全部的安全属性。

**使用 credentials 的 `.env` provider。** 该 provider 属于正在运行的 Cordis 应用，为 credential 引用解析 `$AVN_HOME/.env` 与调用工作目录下的 `.env`。package 命令不启动任何应用，而打包设置也不是 credential，采用该 provider 就意味着为了构建安装包而启动一个 harness。

**要求发布自动化或 shell 导出。** 打包必须能在工作站上运行，而环境已经是 CI 的既有接口。把 `.env` 作为第二个来源不新增任何变量，也不需要第二个文件，而且 shell 设置的值仍然优先。

## Consequences

工作站构建可以把三项打包设置留在仓库根目录的 `.env` 中，不必再为每个 shell 导出。CI 不变：它以环境条目提供这些名字，而 loader 不会改动它们。

loader 在两个命令中都在参数解析之前运行，因此 `.env` 中的坏值会表现为该设置本就产生的打包配置错误，而不是一种新的失败模式。

`DESKTOP_PACKAGING_ENV_NAMES` 成为 Linux 容器转发列表与 loader 共用的唯一列表，因此新增第四项转发设置只需在一个文件中改一处，而不是改两处并可能彼此不一致。

## Testing

`apps/desktop/tests/desktop-environment-file.spec.ts` 覆盖三个约定要点：只复制打包设置的名字，而同一文件中的其他条目被排除在外；目标环境已设置的值被保留；文件不存在时不提供任何内容。
