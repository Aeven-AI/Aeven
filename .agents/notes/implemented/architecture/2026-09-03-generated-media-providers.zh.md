# Agent Note：生成式媒体 provider

Status: implemented

[English](2026-09-03-generated-media-providers.md) | 中文

## 问题

[媒体 seam](2026-09-03-generated-media-capability-seam.zh.md) 交付时没有任何后端，因此什么也生成不了。部署方会去用的那两家 provider——DeepInfra 与 OpenRouter——各自用一个账号提供两种媒介，而两者都触达不到：`avn-llm` 说的是 chat completions，pi-ai 为图片建了模但完全没有视频。

## 决策

**三个 provider 包，按传输层而非按厂商切分。** `avn-media-pi-ai` 注册 pi-ai 的 images 注册表，从而无需手写客户端即可带来 OpenRouter 的图片目录。`avn-media-openrouter` 与 `avn-media-deepinfra` 直接对接视频 API，而 DeepInfra 还自带图片，因为它的 OpenAI 兼容路由与 pi-ai 的 chat-modality 路径是不同的传输层。这种切分保持每个协议一个包；由两种协议提供服务的厂商会出现在两个包中，OpenRouter 今天正是如此。

**每个 provider 都通过自身的内容路由取回字节。** 绝不使用任务体携带的 URL。DeepInfra 的任务体指向 `api.pruna.ai`——实际服务该模型的上游——因此针对这些主机的出口白名单是无界的。两家 provider 都自行代理字节，这让各自的出口保持在一个可固定的 origin 上，也正是 `fetchVideo` 存在于 seam 上、而非由调用方读取 `job.data[].url` 的原因。

**片段被两次限制大小：针对声明的 `Content-Length`，以及针对实际收到的字节。** provider 可能少报，起作用的是第二道检查。

**provider 的状态词汇来自观察而非文档。** OpenRouter 枚举了自身状态，因此它的表就是文档化的集合。DeepInfra 一个也没枚举——其 OpenAPI 规范把 `status` 标为裸字符串——因此它的表记录的是三个实际任务产生的结果，`queued` 映射为 `running`，因为任务在该状态下渲染完整个生命周期；无法识别的值继续轮询，明确的 `error` 字段是唯一可信的失败信号。

**图片按其字节标注类型。** DeepInfra 的 `response_format` 命名的是编码而非图片格式，并且它会以 JPEG 回应一个默认 PNG 的请求。provider 嗅探每张解码图片的签名，对无法识别的签名保留 `application/octet-stream` 而不是猜测。

## 影响

DeepInfra 与 OpenRouter 各自通过一个 seam 生成两种媒介，各用一份凭据，且任何消费方中都没有针对厂商的代码。第四家 provider 就是一个实现一个或两个 provider 契约的包。

按传输层切分意味着 OpenRouter 图片与 OpenRouter 视频位于不同的包中。按厂商看这读起来别扭，两个 README 中都做了记录；另一种做法——每厂商一个包——会把 pi-ai 依赖与手写 HTTP 客户端放进同一个包，而它们毫无共享代码。

现在有两个 provider 携带几乎相同的 `fetchVideo` 实现：固定 origin、双重大小限制、从响应头取媒体类型。对两个 provider 而言这种重复是有意的；一旦出现第三个视频后端，它就是首先要提取的部分。

provider 路由未记录的可选 seam 字段被丢弃而非发送：pi-ai 不承载 `n`／`aspectRatio`／`seed`，DeepInfra 的视频路由未记录 `resolution`／`generateAudio`，DeepInfra 只取第一张参考图。每一项都列在所属包的"已知限制"中，因为被静默忽略的控制项比根本不存在的更糟。

## 验证

三个包的单元覆盖在语句、分支、函数与行上均为 100%：按各路由自身字段名的请求映射、状态表的每一项（含未知值与 error 字段路径）、base64 解码、五种签名的媒体类型嗅探、两条大小限制路径、缺失与空凭据、凭据服务优先于环境变量，以及每次调用的取消透传。

随后以挂载真实插件（而非 mock）的方式对活体 API 做了端到端验证：一张 DeepInfra 图片以 1024×1024 JPEG 返回，一个视频任务由 `queued` 走到 `succeeded` 并返回有效 MP4，两者都用 `file` 校验。正是这次运行发现了硬编码的 `image/png`——任何基于同一假设编写的单元测试都不可能发现它。

## 备选方案

**每厂商一个包。** 否决：OpenRouter 图片经由 pi-ai 抵达、OpenRouter 视频经由手写客户端抵达，因此一个厂商包会容纳两套互不相关的传输层，以及一个只有一半内容需要的依赖。

**调用 pi-ai 的 `generateImages` 注册表入口。** 不可行：该模块不在 pi-ai 的 export map 中。`openrouterImagesProvider()` 返回的 provider 对象自带 `generateImages`，这也让模型、鉴权与传输由同一个对象解析。

**信任 `response_format: 'b64_json'` 意味着 PNG。** 在一次活体调用对默认 PNG 的请求返回 JPEG 后否决；该字段命名的是编码，而非格式。

**在 provider 内部轮询直到任务落定。** 否决：拥有自己节奏的调用方可以呈现进度，而阻塞的 provider 不能。seam 的 `videoStatus` 按设计只报告一次。
