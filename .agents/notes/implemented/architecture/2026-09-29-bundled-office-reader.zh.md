# Agent Note: The Office reader ships its engine; document readers have no setup

Status: implemented

[English](2026-09-29-bundled-office-reader.md) | 中文

## 问题

`@aeven/document-extract-office` 调用标准版 LibreOffice。未安装时，设置 → 文档页提供约 300 MB 的下载（安装后约 800 MB）。因此读取器带有就绪状态：注册表发布它，`documents` Remote 以流的形式传递它，该设置页渲染它。最终用户必须先理解并完成这一设置，旧版 Office 附件才能读取。

## 决定

**引擎是 npm 依赖。** Office 读取器依赖确定版本的 `@deepseek-ai/libreoffice-kit`。该工具包为每个目标平台声明一个按平台过滤的可选依赖引擎（解压后 147–190 MB），与 DeepSeek Harness 随包提供的是同一个包。Desktop 种子的 pnpm 安装会选择目标平台的引擎。读取器在启动时创建一个转换器工厂，因此缺少引擎时插件在加载阶段失败。它将 `.doc`、`.docx`、`.odt` 读取为文本，将 `.xls`、`.xlsx`、`.ods`、`.ppt`、`.pptx`、`.odp` 转换为 PDF 交给注册表中的 PDF 读取器。它以优先级 10 排在内置读取器之后运行。

**文档读取器无需设置。** 已移除 `DocumentPreparation`、提供者就绪状态、`follow`/`prepare`/`cancelPreparation` 操作、`@aeven/api-document-extract` 包以及该设置页。注册表是静态的提供者集合；`accepted()` 为输入框的文件接收提供格式列表。

**Desktop 签名为引擎授予 JIT。** macOS 种子签名为 `@deepseek-ai/libreoffice-kit-darwin-*` 中的 `bin/libreoffice-kit` 授予 `com.apple.security.cs.allow-jit`，与 DeepSeek Harness 相同。其他所有 Mach-O 文件保持普通的强化运行时。第三方声明生成器仅对该工具包的确切包标识接受 MPL-2.0。

## 考虑过的替代方案

**随包提供标准版 LibreOffice 应用。** 安装后增加约 800 MB，而裁剪它意味着修改并重新签名第三方应用包。该工具包是预构建且经过验证的引擎，已附带源码与许可证材料。

**保留按需下载但去掉设置页。** 首次使用时下载仍会让第一个旧版附件等待大文件传输，并且仍需要某处提供进度、失败与重试界面。随包提供引擎消除了这一状态。

## 影响

Pages 与 Keynote 文件不再可读：该工具包的引擎不导入这些格式，注册表将其作为不支持的格式拒绝。每个 Desktop 目标增加其引擎大小。Windows 需要 Microsoft Visual C++ v14 运行库，工具包不附带。Linux 安装该工具包的 WASM 引擎。
