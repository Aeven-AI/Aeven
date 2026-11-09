# Agent Note: Motion films are reviewed apart from being shown

Status: implemented

[English](2026-11-09-motion-review-apart-from-show.md) | 中文

## Problem

`show_motion` 既是用户观看影片的方式，也是模型查看影片的唯一途径：静帧只来自 `show_motion` 调用，并在整部影片中均匀分布。在一个 35 分钟的会话中，模型调用了它十二次，大多是为了检查自己的修改，还另建了一个 `_review` 合成，甚至为查看两个场景而裁剪了正式影片的 `index.html`，而这些都展示给了用户。卡片让情况更糟：正在运行的调用会立即占用其文件夹，因此屏幕上的影片在整个渲染期间消失，被加载行取代，而且早前的影片没有留下任何可供比较的痕迹。

## Decision

- **审阅是独立的工具。** `review_motion`（[`avn-tool-motion`](../../../../packages/motion/tool-motion/README.zh.md)）渲染一份草稿，只把静帧返回给模型：可指定影片时间、在某个场景的时间窗内均匀分布，或在整部影片中均匀分布。`show_motion` 不做任何渲染，只负责展示文件夹。`ctx.motion` 接受明确的静帧时间（`stillTimes`），不再是均匀分布的数量，[`avn-motion-hyperframes`](../../../../packages/motion/motion-hyperframes/README.zh.md) 与沙箱中的 `render-motion`（`--still-times`）均已支持。
- **不展示未完成的影片。** 两个工具都会先静态读取 `index.html`，拒绝根元素没有时长、场景文件缺失或场景超出影片末尾的合成。`show_motion` 还会拒绝比同一会话中同一文件夹上次展示的时长短于 `shrinkRatio`（默认 0.5）的影片，除非调用传入 `force`。
- **屏幕上的影片保留到替代者就绪为止。** 在屏幕上运行的 `show_motion` 卡片只有在自己的影片就绪后才占用其文件夹；失败的调用从不替换影片。挂载时已完成的卡片仍像以前一样立即占用。替代影片渲染期间，其行显示“正在更新影片…”。
- **早前版本仍可找到。** 被替换的卡片折叠为一行“早前版本 · 时间 · 时长”，可展开该调用存储的影片。
- **技能教授先审阅、再展示。** `motion` 技能用 `review_motion` 检查每一轮，并在每轮完成时只调用一次 `show_motion`，从不用于临时合成。

## Alternatives considered

**为 `show_motion` 增加 `present: false` 参数**被否决：一个工具名对应两类受众会招致同样的误用，而审阅的参数（时间、场景）对展示毫无意义。**只渲染某个场景自身的时间范围**会让场景审阅更快，但需要修改渲染器；在完整的草稿渲染上把静帧分布到场景时间窗内，可以保持渲染器契约不变。**联系表图片**被推迟：最多 12 张按指定时间截取的静帧已能覆盖任意时刻。**从会话日志中读取上次时长**而不是使用工具自身的内存被否决，因为对同样的防护来说代价更高；Host 重启后的第一次重新展示不受防护。

## Consequences

审阅仍以草稿质量渲染整部影片，因此耗时约等于影片时长。缩短防护存在于工具的进程内存中，会随 Host 重置。托管 Host 必须重新安装沙箱中的 `render-motion`（`install-motion.sh`）才能使用 `--still-times`。从历史记录重放的对话会把每部被替换的影片显示为一行，而不是什么都不显示。
