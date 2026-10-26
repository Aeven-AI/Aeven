# Agent Note：桌面登录由应用收取

Status: implemented

[English](2026-10-26-desktop-sign-in-is-collected-by-the-app.md) | 中文

## 问题

桌面端提供方登录（Google、X、Apple）在操作系统分配的端口上开启回环监听，并让系统浏览器经过它，因此网关把完成的登录送回 `http://127.0.0.1:<port>/oauth-result/...`。读者看到的是本地地址而不是 Aeven 站点；监听结束后（超时、被替换、重启）才完成的登录会落到失效页面。

## 决定

外壳生成一个 verifier，并以 `?app=desktop&nonce=<sha256(verifier)>` 在系统浏览器中打开提供方路由（[oauth-browser.ts](../../../../apps/desktop/src/oauth-browser.ts)）。网关（`servers/node`，`passport/OAuthRedirectTarget.js`）把该哈希记在会话上，对 Apple 不带 cookie 的 form-post 回调还记在签名的 `state` 中。提供方完成后，网关把 session/challenge 对或拒绝结果以该哈希为键存入 Redis，保留十分钟（`passport/DesktopHandoff.js`），并让浏览器停在 `https://aeven.io/oauth-result/desktop`，这是一个显示 "You are signed in to Aeven. You can close this page and return to the app." 的品牌页。外壳每秒向 `/oauth/desktop/claim` 提交 verifier，只收取一次该对值，并通过持有 API 刷新 cookie 的会话完成交换。网络失败和服务器错误视为尚未收取到结果。网关的遮罩从按下起即显示，被按下的提供方按钮显示进度；未完成就返回的读者在获得焦点两秒后重新看到表单，浏览器从未获得焦点时为五秒。外壳先完成交换，再把窗口带到前台并报告 `signed-in`，窗口随即显示加载遮罩；超时或失败时报告 `ended`，清除进度。因此读者从浏览器回来时，不会在登录完成期间看到一个空闲的登录表单。

## 考虑过的替代方案

**保留回环监听。** 浏览器会显示本地地址，并且依赖监听活得比登录久。

**经由 `aeven:` URL scheme 返回。** 浏览器会询问读者是否打开应用，而注册了该 scheme 的其他应用可能读到这对值。

## 影响

浏览器既不访问本地地址，也不打开应用；读取起始 URL 或浏览器历史只能得到哈希，而哈希收取不到任何东西。网关改动必须先于使用它的桌面版本部署；旧网关会忽略该标记并返回到配置的 Web 客户端。没有 Redis 的网关会让浏览器停在失败页面。`@aeven/web-app/sign-in` 中的无界面 `avn` 登录仍使用回环监听。
