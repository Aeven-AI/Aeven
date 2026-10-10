# Agent Note: 单模型图片数量写在模型自身文本中

Status: implemented

[English](2026-10-10-per-model-image-count-in-the-model-text.md) | 中文

## Problem

`generate_image` 会发布一句描述每个可选模型的话，它由组合的 `choices` 经 `modelsText` 生成；对于由 Provider 自行列出的模型，则取自该 Provider 自己的目录条目。[让描述列出每个 choice 选项的那项决策](../architecture/2026-10-01-aeven-image-models-only.zh.md)把每一项单模型事实都带进了这句话——尺寸、参考图数量、背景、seed——唯独遗漏了单次请求可要求的图片数量。该数量是由 Provider 持有、按模型区分的请求上限：`media-aeven` 在每个 Aeven 图片模型上声明 `maxImages`，`requestBody` 会在发出任何请求之前拒绝超出范围的 `n`。模型读到的描述从未写明它，于是模型组合了高于上限的 `n`，Provider 拒绝了整次调用，该轮以完全没有图像结束——这个上限在包 README 中有文档、在代码中有强制，却在模型读取的接触面上不可见。

同一缺陷在 `media-pi-ai` 中以相反方向存在。其上游路径不承载数量，`request.n` 因此被静默丢弃：请求多张图片的调用只收到一张，却报告成功，对调用方没有收到所请求数量一事只字未提。

## Decision

**模型自身的文本写明它的单次调用图片数量。** `AEVEN_IMAGE_MODELS` 的描述现在携带 `maxImages` 所强制的数量，内置 `aeven` preset 中已配置的图片 choice 也写明它，因为 `modelsText` 会在注册时把这些 choice 渲染进 `generate_image` 描述。数量始终按模型与 Provider 区分：`Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro` 各自写明四张，pi-ai 的模型不声明也不接受数量，OpenRouter 与 DeepInfra 则把数量交给各自的路径。任何地方都不写明全 Harness 通用的数字。

**`generate_image` 自身不声明任何上限。** `n` 参数说明数量来自所选模型的描述，工具描述则告诉模型：超过单次调用可接受数量的请求应改为再次调用。`resolveRequest` 没有增加第二个校验器：Provider 会在花费任何东西之前拒绝无法满足的数量，工具的职责是说明模型可以请求什么，而不是复述 Provider 所强制的内容。

**无法满足数量的 Provider 会拒绝它。** `media-pi-ai` 对大于一的 `n` 返回 `MEDIA_INVALID_REQUEST`，与 Seam 的规则一致：无法满足某项选项的 Provider 应拒绝该请求，而不是静默产出别的东西。数量为一则被接受，因为该路径本来就会返回一张图像。

## Verification

每处陈述都与强制它的字段绑定，因此文本不会与 Provider 漂移。`media-aeven` 的 spec 断言每个内置模型的描述都包含 `up to <maxImages> images per call`。真实组合 spec 会经 Loader 启动内置 preset，并检查模型可见的 `generate_image` 描述中每个已配置 choice 的分句写出了其 Provider 声明的数量。`tool-media` 的 spec 固定 `n` 的描述与再次调用的那句话。`media-pi-ai` 的 spec 固定该拒绝行为以及数量为一被接受。`packages/media/media-aeven/tests/media-aeven.spec.ts`、`packages/media/tool-media/tests/loader-composition.spec.ts`、`packages/media/tool-media/tests/tool-media.spec.ts`、`packages/media/media-pi-ai/tests/media-pi-ai.spec.ts`。

## Alternatives considered

**在 Seam 上以 `MediaImageModel.maxImages` 承载该上限，并在工具中拒绝超量调用。** 否决：这会为 Provider 已在花费之前最后一步强制的一项约束再加一个校验器；而且其他每一项单模型事实——尺寸、时长、宽高比、参考图数量、引导支持——都是以模型自身文本的形式到达模型的，只把数量做成结构化字段属于漏掉了一次提取，而不是修复。

**在工具内部把大额请求拆分到多次 Provider 调用。** 否决：一次工具调用会静默变成两次计费——选择器、报告的费用以及 `Generated <n> image(s)` 一行描述的都是单次 Provider 调用。由模型刻意发起的第二次调用能让这些事实保持真实，模型也可以告知用户它正在做什么。

**在 `n` 的描述中写明一个统一上限。** 否决：数量因模型与 Provider 而异。Aeven 的模型接受四张，pi-ai 不接受，OpenRouter 与 DeepInfra 把数量交给 Harness 并不知晓其自身限制的路径。

**由 Provider 目录而非 preset 组合出 choice 描述。** 否决：工具描述在注册时一次性构建，而 `ctx.media.listImageModels()` 是异步的，因此组合的 choice 仍是模型所读内容的编写归属地，与视频 choice 早已如此完全一致。

## Consequences

- 模型会按所选模型可接受的数量请求，并为更多图片再次调用，因此 Aeven 模型不再因为一个本可获知的数量而让整次生成失败。
- 每个数量有两个编写归属地——Provider 目录与内置 preset 的 choice——与其他每项选项事实一样。spec 把每个归属地与强制它的字段绑定，因此改动 `maxImages` 而未同步文本会失败在测试上，而不是到达模型。
- 对 Provider 未声明数量的模型，Harness 仍不写明上限；这类调用继续在该 Provider 的路径上失败，并带上 Provider 自己的消息。

## Deferred

`media-pi-ai` 仍不转发 `aspectRatio`、`resolution`、`size` 与 `seed`，因此指明其中任一项的请求会按模型自身设置生成。该缺口是本包已记录的限制，而非本缺陷的一部分；拒绝这些选项应属于它自己的改动。
