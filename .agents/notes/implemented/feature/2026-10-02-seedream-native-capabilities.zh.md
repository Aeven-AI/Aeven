# Agent Note: Seedream 原生图片能力

Status: implemented

[English](2026-10-02-seedream-native-capabilities.md) | 中文

## 问题

DeepInfra 的 OpenAI 兼容图片列表遗漏 Seedream 4.5 和 5.0 Pro，其图片路由会忽略未声明的字段。分辨率档位、额外参考图和原生生成控制项需要不同路由；在兼容路由上接受这些字段可能为忽略请求的图片收取费用。

## 决策

DeepInfra 提供方通过 `/models/list` 发现未弃用的图片模型，并对 Seedream 4、4.5 和 5.0 Pro 使用原生推理。媒体 seam 和 `generate_image` 在尺寸、分辨率、种子、参考图和背景之外携带引导强度、输出格式及提示词优化。Aeven 提供方把这些控制项转发至网关；Image Flash 映射为 Seedream 4，Image Pro 映射为 Seedream 5.0 Pro。各提供方拒绝其传输方式不支持的控制项。

原生图片仅从受支持模型返回的精确 HTTPS Ark CDN 主机下载，不带授权，也不跟随重定向。读取流时执行配置的字节上限。DeepInfra 凭据只发送到 API origin。[生成式媒体提供方](../architecture/2026-09-03-generated-media-providers.zh.md) 继续负责通过各提供方的内容端点取回视频。

种子是提供方输入，不是确定性承诺。原生 `n` 执行独立调用；DeepInfra 不暴露 Ark 的水印或顺序生成开关。返回字节决定图片媒体类型和实际尺寸。

## 后果

助手可以请求各受支持模型的原生生成设置，无需为每次生成额外调用发现接口。每张原生图片增加一次不带凭据的 CDN 下载，受图片字节上限约束。模型选择器和工具描述列出网关模型的当前选项。

## 验证

TypeScript 检查与完整构建验证变更的请求类型和发布产物。实际 `avn` profile 使用分辨率、种子、引导强度和参考图返回了 Seedream 4 JPEG；原生 5.0 Pro 接受四张参考图、JPEG、不透明背景和快速优化，费用为 $0.0594。其结果确定了第二个允许的 Ark CDN 主机。按用户要求，最终验证不运行测试套件，也不再发起生成调用。

## 考虑过的替代方案

向兼容路由发送原生控制项不能证明支持，因为未知字段会被忽略。把分辨率档位转换为正方形像素尺寸会丢失模型自身的尺寸行为。将 API bearer 转发至厂商 CDN 会把凭据暴露在其 API origin 之外；重定向也可能把下载移至允许主机之外。
