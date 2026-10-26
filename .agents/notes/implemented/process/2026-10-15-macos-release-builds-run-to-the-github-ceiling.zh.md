# Agent Note: macOS 发布构建用满 GitHub 的作业上限

Status: implemented

[English](2026-10-15-macos-release-builds-run-to-the-github-ceiling.md) | 中文

## 问题

`.github/workflows/release-desktop.yml` 的 `build` 作业给 matrix 中每个目标都设了同一个 `timeout-minutes: 150`。签名 macOS 目标在其 `Package` 步骤内完成公证，而这段等待取决于 Apple 的队列而非 runner 的工作量，因此可能超出该窗口，作业在打包中途被终止。`release` 需要每个 build 作业都成功，所以一个被终止的 macOS 目标会带走整次运行：已完成目标的安装包与更新源被一并丢弃，什么也不会发布。

## 决定

- **macOS 目标用满 GitHub 六小时的作业上限。** `timeout-minutes` 改为 `${{ startsWith(inputs.target, 'mac-') && 360 || 150 }}`。两个 macOS 目标获得 360 分钟，即 GitHub 托管作业允许的最长时间；Windows 与 Linux 目标仍为 150。
- **窗口由目标推导，而不是加进目标清单。** `plan` 作业的 JSON 条目继续只描述某目标在何处构建、用哪个脚本；build 作业自行依据 `inputs.target` 推导窗口。

## 考虑过的替代方案

**所有目标统一给 360 分钟。** 改动最小，但 Windows 或 Linux 上卡住的打包步骤会在失败前占用 runner 六小时，而这些目标大约十二分钟即可完成打包。

**把公证挪出 build 作业。** 用 `notarytool submit --no-wait`，再由单独的作业轮询票据并装订磁盘映像，可以把等待移出打包 runner——但发布仍要等装订完成，所以发布依旧受同一个 Apple 队列制约，而且提交 id 还得在作业之间传递。

**在目标清单的每个条目上加 `timeout` 字段。** 数值与它适用的 runner 相邻可读，代价是四个短目标上重复 150，并使 `plan` 作业本就以 JSON 字面量发出的清单进一步膨胀。

## 后果

- 签名 macOS 构建会按公证实际耗时占用 runner；GitHub 会忽略托管 runner 上超过 360 的 `timeout-minutes`，因此工作流内无法再延长窗口。
- 若某次公证被 Apple 队列拖过六小时，该目标会被终止。其他目标[独立发布](2026-10-26-desktop-targets-publish-independently.zh.md)。延长公证等待时间需要自托管 runner，或在 CI 之外完成公证。
