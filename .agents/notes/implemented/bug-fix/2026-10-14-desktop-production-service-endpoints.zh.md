# Agent Note: Desktop 生产服务端点

Status: implemented

[English](2026-10-14-desktop-production-service-endpoints.md) | 中文

## 问题

Desktop Host 从基础和 Web bundle 继承开发 URL。安装后的应用若没有环境设置，会访问 localhost 的 9000 和 9020 端口，且没有 OAuth 提供方 URL。仓库 `.env` 不随应用安装，因此后端成功启动后，页面仍可能等待无法访问的 API。

## 决策

[打包的 Desktop Host overlay](../../../../apps/desktop-host/config/desktop.cordis.patch.yml) 拥有与仓库操作者确认的部署一致的生产默认值：API 使用 `https://aeven.io/api`，Web、媒体和 OAuth 使用 `https://aeven.io`。身份认证方、模型路由、媒体提供方和账户集成使用相同的 API 默认值，并接受 `AEVEN_API_URL` 覆盖。搜索路由从启动环境解析该 API 基址并追加 `/v1`，因此 overlay 只携带其凭据引用和模型；启动环境未指明基址时由桌面壳提供，因为打包应用不携带 `.env`。Web、媒体和提供方 URL 接受对应环境变量覆盖。Desktop OAuth 使用 `window`，因为重定向应用文档会替换桌面壳。

只有公开服务 URL 进入 overlay。打包过程不把 `.env` 或其中凭据复制到发布产物。基础和 Web bundle 保留开发默认值。[打包环境加载器](../process/2026-09-14-desktop-packaging-reads-the-repository-env-file.zh.md) 继续负责构建设置，而非已安装运行时的服务发现。

## 考虑过的替代方案

**在安装时创建主目录 `.env`。** 这会让正常启动依赖可变的机器配置，并使全新安装缺少应用自身的部署默认值。

**把仓库 `.env` 复制进发布产物。** 这会把公开部署设置与凭据及其他工作站配置混在一起。已安装应用需要公开 URL，而非构建机器的环境。

**只修补身份认证方。** 登录可能访问生产环境，但推理、搜索、媒体和账户集成仍访问开发服务器。

## 影响

全新 Desktop 安装无需主目录 `.env` 即可访问配置的生产部署；操作者仍可通过环境变量覆盖选择预发布或本地服务。替换插件配置会替换全部字段，因此搜索模型和凭据引用以及 Slack 回调设置仍在 overlay 中显式声明。生产 URL 变化需要发布版本或操作者显式覆盖。

[组合回归测试](../../../../apps/desktop/tests/service-endpoints.spec.ts) 加载并组合实际的基础、Web 和 Desktop patch 文件，分别在隔离的空环境和部署覆盖环境中求值服务配置。缺少这些默认值的 overlay 会使两个用例均失败。测试覆盖配置，而非网络可用性或打包 Electron 登录；Session 日志输出不变。
