# Agent Note: generate_image 的输出 schema 声明其返回的已存引用字段

Status: implemented

[English](2026-10-05-generated-image-output-schema-declares-stored-reference-fields.md) | 中文

## 问题

`generate_image` 声明的输出值中，`images` 的条目只列出 `attachmentId`、`mediaType`、`bytes`、`width` 和 `height`，但它返回的每个已存引用正是 `ctx.attachments.saveImage()` 构建的那一个——即 `ImageAttachmentRef`；当归一化缩放了光栅时它还带有 `originalDimensions`，当存储收到了名称时还带有 `name`。工具运行时以 `additionalProperties: false` 校验声明的输出 schema，因此只要提供方产出的光栅超过存储的归一化像素预算，调用就会在图像已生成并已存储之后失败：

```
tool "generate_image" returned invalid output: "value.images[0].originalDimensions" is not a declared property (additionalProperties: false)
```

模型看到的是一次错误，生成调用处的图像通道渲染出它的失败状态而不是交付的图像，而已存储的字节留在附件存储中没有任何引用指向它们：这次生成付了费，随后被丢弃。在已发布的 `aeven` 路由上，一次 2K 生成就会触发它——该路由的超宽答复超过 `DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS` 允许的 4,194,304 像素，存储将其缩放，而正是这次缩放添加了 `originalDimensions`。任何超过该预算的生成光栅都会失败，而这一条件只由尺寸档位决定。

## 决策

`images` 的条目声明 `name` 与 `originalDimensions`——即 `ImageAttachmentRef` 在标识与光栅字段之外携带的两个可选字段，也是 `read_image` 的 `IMAGE_VALUE_SCHEMA` 为同一个值声明的同一组字段。两者都保持可选：`originalDimensions` 仅在存储缩减了光栅时出现，`name` 仅在引用自带名称时出现。

工具的其他部分不变：返回值保留存储报告的每一项事实，`render` 投影器、其摘要行、模型选择器与图像通道都未被改动。

## 测试

`tool-media.spec.ts` 分别用报告 `originalDimensions` 的存储替身、以及带名称的提供方已存引用运行该工具，断言两次结果都携带这些字段且没有错误。`loader-composition.spec.ts` 通过 Loader 启动已发布的 `aeven` preset，挂载真实的附件存储，并让被替身的网关返回一张超过归一化像素预算的 PNG，断言调用成功、存入的光栅落在预算之内、输入尺寸被报告，并且结果携带图像通道用于显示的图像块。三个用例在修复前的源码上都会失败——组合用例失败在 `isError` 断言处——修复后通过。这两个 spec 原本携带的渲染文本断言也与 preset 已发布的摘要行不一致，使该包在本次改动之前于 `HEAD` 上就是红的；现在它们断言的是已发布的文本。

## 考虑过的替代方案

**在 `execute` 中把结果收窄为已声明字段。** 用 `imageBlockRef`（它已为图像块做过收窄）映射每个引用，无需改动 schema 即可让失败的用例通过。未采纳：它改变的是工具发布的内容——结果不再报告提供方自己的光栅尺寸——只是为了迁就一份本就不完整的声明，并丢弃了存储为该返回值报告的事实。

**为已存引用抽出唯一的 schema 片段。** 该工具与 `read_image` 便能只保留一份字段表，而 `pnpm run duplication` 目前把两者报为 95 token 的克隆。当第三个消费者需要这些字段时值得做；它比这个缺陷更大，并会在同一次改动中改动第二个工具的已声明输出。

**放宽 schema 的 `additionalProperties`。** 未采纳：封闭 schema 正是让未声明字段成为显式失败的原因，放宽它也会掩盖下一个同类错配。

**在存储层去掉这些字段。** 未采纳：`ImageAttachmentRef` 是附件 seam 自身的词汇，被读取方、上传与请求路径共同使用；存储后端不是编码某个消费者输出 schema 的地方。

## 后果

结果接受并报告存储返回的引用，因此只要提供方的光栅超过存储的归一化预算，生成的图像就能抵达对话——这一条件由尺寸档位决定，而不是提示词。

这组可选字段在两个包中为同一个值各声明一次，在抽出共享片段之前，duplication 门禁会持续报告它。

校验仍然在提供方调用与存储写入之后运行，因此未来同类的错配仍会让这次生成付出代价，并留下无人引用的字节。要回滚这一点，就需要在副作用发生之前用值的类型校验其 schema，而对存储尚未产出的值，seam 无法做到。

## 相关

- [Generated images at their tool calls](../feature/2026-10-02-generated-images-at-tool-calls.zh.md) 拥有本次失败所抢先的图像通道，以及两个过期断言所更新以匹配的摘要行。
- [Unified normalized attachments, request versions, and provider files](../feature/2026-08-20-unified-image-request-pipeline.zh.md) 拥有产生 `originalDimensions` 的归一化策略及其像素预算。
