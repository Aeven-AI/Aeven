# Agent Note: A motion export reports its progress and reuses an unchanged film

Status: implemented

[English](2026-11-09-motion-export-reports-progress.md) | 中文

## Problem

从 Motion 卡片把影片导出为 MP4 时，在文件到达之前只显示一个忙碌的按钮。会话 `04b4db03` 中那部 100 秒的影片在 M 系列 Mac 上以任何质量档位渲染都约需 37 秒（在该影片上实测：draft 36 秒、standard 36 秒、high 37 秒），而排在智能体自身审阅渲染之后的导出等待得更久，因此导出看起来像是坏了。按文件夹导出还是一个长请求，而且即使什么都没改，每次导出也会重新渲染整部影片。

## Decision

- **两条导出路由都报告进度。** [`avn-api-motion`](../../../../packages/motion/api-motion/README.zh.md) 为每个文件夹或调用只运行一次渲染；每个请求最多等待 `exportWaitMs`（现为 1500 毫秒），否则以 `{ fraction, queued }` 回答 202。卡片轮询并显示“正在导出 MP4… n%”，在渲染器尚未报告任何进度时显示“正在导出 MP4…”，或显示“正在等待另一个渲染完成…”。
- **排在另一个渲染之后的渲染会说明这一点。** `ctx.motion` 定义了 `MOTION_QUEUED_STAGE`，HyperFrames 渲染器在渲染等待轮到自己时报告它。
- **未改动的影片不会重新渲染。** `ctx.motion` 在每次渲染旁的附属文件中记录其质量与修改时间（`recordRender`、`currentRender`）。只要附属文件与导出质量一致且 `renders/` 之外没有更新的文件，导出就会返回上次的导出，否则返回智能体上次 `review_motion` 的渲染（复制到位）。`review_motion` 以 `reviewQuality`（默认 `high`，即导出质量）渲染，因此智能体在展示影片前做的审阅就是用户随后请求的导出。
- **导出质量保持 `high`**，因为在该影片上它与 `draft` 相比没有可测量的时间开销。

## Alternatives considered

**降低导出质量**被否决：三个档位渲染同一部影片的时间相差不到一秒。**保留草稿质量的审阅**同理被否决：草稿审阅无法代替导出，而且并不省时。**让用户导出插队到排队中的智能体渲染之前**被推迟：正在运行的渲染无法被抢占，而排队状态现在会告诉用户导出为何在等待。**通过服务器推送事件传输进度**被否决，改用现有的 202 轮询，按调用导出已在使用它，而且它能保持在代理的读取超时之内。

## Consequences

托管环境中的沙箱渲染器不报告进度，因此在那里卡片显示不带数字的“正在导出 MP4…”。只在 `renders/` 内被编辑的文件夹会复用其导出。新鲜度检查在遍历 10,000 个条目后停止，此时会重新渲染。
