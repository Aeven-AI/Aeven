# Agent Note: 打包的 Desktop 携带其部署设置与登录 peer

Status: implemented

[English](2026-10-14-desktop-packaged-deployment-and-peer-alias.md) | 中文

## 问题

`dev:desktop` 可以工作而打包的应用不行，原因有两个，都被开发路径掩盖了。`@aeven/subscription-auth` 加载的 `dsh-coding-oauth-core` 以 peer 形式导入 `@deepseek-ai/dsh-llm`；仓库安装会自动添加该 peer，但 Desktop profile 设置了 `autoInstallPeers: false`，因此 staging Host 的健康检查以 `ERR_MODULE_NOT_FOUND` 失败。随附的 profile 行还会从 Host 环境读取 Aeven 账户、网页、媒体与登录 URL；`dev:desktop` 从仓库 `.env` 加载它们，而已安装的副本没有这些值，因此登录指向 `http://localhost:9000` 且不提供任何登录方式。

## 决定

- **seed 用核心 tarball 满足该 peer。** `desktopCorePackageOverrides` 把 `@deepseek-ai/dsh-llm` 作为 `@aeven/llm` tarball 的别名加入，既作为 override 也作为根依赖；hoisted 布局会把它放在 `dsh-coding-oauth-core` 解析的位置。对 seed lockfile 的扫描没有发现 Host 会加载的其他未满足 peer。
- **打包把部署设置记录在应用中。** `AEVEN_API_URL` 为必需；`AEVEN_WEB_URL`、`AEVEN_MEDIA_URL`、三个 `AEVEN_OAUTH_*_URL` 值与 `SLACK_CLIENT_ID` 在已设置时记录。electron-builder 把它们作为 `aevenDeployment` 写入应用的 `package.json`；打包与 `AVN_DESKTOP_APP_ID` 一样从仓库 `.env` 读取它们，发布工作流则从仓库变量传入。
- **外壳在启动时把它们交给 Host**，启动环境已设置的值保持不变。

## 考虑过的替代方案

**把 `@deepseek-ai/dsh-llm` 声明为 `@aeven/subscription-auth` 的依赖。** 这能修复所有安装，但该 npm 包会把更多 DSH 包带入产品依赖图；而在工作区中改为指向 `@aeven/llm` 的别名，会超出本次修复改变开发依赖图与 lockfile。

**在 Desktop profile 中启用 `autoInstallPeers`。** 这也会安装 seed 有意从 Host 依赖图中去掉的浏览器库 peer。

**把这些 URL 作为默认值写进 profile 行。** 这些行服务于所有部署，而仓库的可配置性规则不允许把随部署变化的值放进插件默认值。

## 影响

- 缺少 `AEVEN_API_URL` 时，打包会在 electron-builder 启动前失败。
- 未设置其他仓库变量时构建的发布版本会缺少相应的登录方式，并保留媒体默认值。
- seed 的离线安装证明仍不会启动 Host，因此缺失的运行时导入只会在应用自身的健康检查中暴露。
