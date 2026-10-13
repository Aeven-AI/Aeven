# Agent Note：生成式媒体能力 seam

Status: implemented

[English](2026-09-03-generated-media-capability-seam.md) | 中文

## 问题

图片生成在 harness 中只以厂商专用的工具代码存在，而且位于 harness 之外。一个第三方插件携带了两份彼此独立的实现——一份用于 Codex 图片，一份用于 Grok Imagine——各自拥有自己的 HTTP 客户端、自己的产物存储、自己的保留策略与自己的工具面。新增第三个 provider 就意味着把这四样再抄一遍。

视频则处处都没有实现，而部署方真正会去用的 provider 也无从触达：`avn-llm` 说的是 chat completions，而 DeepInfra 的 chat route 刻意以 `requireTags: ['chat']` 过滤其目录，因为同一份文档还列出了该 route 无法调用的图片、视频、语音与嵌入模型。有人问为什么 DeepInfra 的视频模型从不出现在模型选择器里，其实是在要一项 harness 尚不具备的能力，而不是要求放宽某个过滤器。

## 决策

**生成式媒体是一个能力 seam，而非一个工具。** `ctx.media` 拥有 provider 注册表、选择、任务约定与错误分类；provider 拥有协议与凭据；消费方拥有模型所能看到的一切。图片与视频共享一个 seam，理由与 `avn-web` 中搜索与抓取相同——它们共享 provider 标识、凭据、取消与错误，拆开会把这四样都复制一遍。

**视频状态联合类型为 `running | succeeded | failed`，由 provider 映射到它。** 该词汇沿用 OpenRouter 的，因为它是所调研 provider 中唯一枚举了自身状态的。这种映射是承重的而非表面的：DeepInfra 对正在渲染的任务报告 `queued`，且根本不发布任何运行中状态——在 200ms 轮询下观察到的三个任务（包括一个耗时 27.6 秒的 10 秒片段）都直接由 `queued` 转为 `succeeded`。若某个适配器把 `queued` 读作"尚未开始"，它将误报自己运行过的每一个任务。seam 的状态描述调用方接下来能做什么，而不是上游选择了什么称呼。

**字节通过 provider 自身的内容路由取回，绝不使用任务体携带的任何 URL。** 中介方的任务体指向的是实际服务该模型的上游——DeepInfra 指向 `api.pruna.ai`——因此针对这些主机的出口白名单是无界且无法固定的。所调研的两家 provider 都自行代理字节（`Content-Type: video/mp4`，已对真实片段验证），这把出口保持在部署已经信任的主机上。这正是 `fetchVideo` 作为 seam 方法存在、而非由调用方读取 `job.data[].url` 的原因。

**选择按调用解析，且从不猜测。** 先是请求指名的 provider，然后是配置的 provider，最后是唯一可用的那个；其余情况一律为带错误码的失败。轮询与获取按任务自身记录的 provider 路由，而不是重新执行选择，因此任务不会在轮询与获取之间漂移到另一个后端，挂载第二个 provider 也不会悄悄改变已经能用的调用。

## 影响

新增一个 provider 就是一个实现 `MediaImageProvider` 或 `MediaVideoProvider` 的包；它继承选择、取消、任务约定与错误分类。插件中那两份私有实现将成为该 seam 背后的 provider，而不再是并行的工具栈，这消解了四项重复关注点中的三项。

seam 刻意不做存储、也不做轮询。消费方决定产物存活多久、以何种节奏观察任务，因此工具可以呈现进度而不是阻塞在服务内部。这使得持久化在第一个消费方交付前无人拥有，这是有意的顺序而非疏漏。

`MediaVideoStatus` 是封闭联合类型。新增一个状态是跨所有 provider 由编译器强制的改动，这正是要点：provider 无法悄悄引入第四种状态而让消费方默默处理错误。

## 验证

单元覆盖在语句、分支、函数与行上均为 100%：按种类的重复注册、随 fiber 释放、每一种选择结果（含"缺失"与"不可用"的区分）、请求优先于配置、按任务自身 provider 的路由、取消透传，以及任务的 provider 已被释放时的失败。状态映射与内容路由的决策是在编写类型之前对活体 API 确立的，而非从文档推断——DeepInfra 自己的 OpenAPI 规范把 `status` 标为无枚举的裸 `string`，并把 `/content` 声明为 `application/json`，二者都被实际调用推翻。

## 备选方案

**放宽 DeepInfra chat 目录的 `requireTags: ['chat']` 过滤。** 否决：那会在一条协议上无法调用它们的 route 上宣传视频模型，选中其一将在传输层失败。过滤器是对的；缺失的能力在别处。

**为 `avn-llm` 扩展图片与视频方法。** 因形态不匹配而否决。chat 是流，图片生成是请求／响应，视频是带独立轮询与取回的任务。把 LLM 适配器扩宽到容纳三者，会迫使每个既有适配器携带自己无法实现的方法。

**每种媒介一个 seam。** 否决：两者会共享 provider 标识、凭据、选择、取消与错误分类，而所调研的两家 provider 都用同一个账号与同一个 base URL 提供两种媒介。

**以插件既有的 Imagine 客户端为 seam 蓝本。** 因过于狭窄而否决。该客户端固定单一 origin、每种媒介单一模型 id，以及固定的输出主机白名单——这些假设对单一厂商成立，对中介方则不成立。
