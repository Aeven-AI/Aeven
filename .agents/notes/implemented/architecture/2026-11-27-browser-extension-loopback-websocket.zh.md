# Agent Note：浏览器扩展通过已配对的回环 WebSocket 连接桌面应用

Status: implemented

[English](2026-11-27-browser-extension-loopback-websocket.md) | 中文

## 问题

Aeven 浏览器扩展过去通过 Chrome 原生消息主机连接桌面应用。在 Windows 上，浏览器只能通过 `HKCU\Software\<browser>\NativeMessagingHosts` 下的键找到该主机，而 [Microsoft Store 包](../process/2026-11-21-microsoft-store-msix-package.zh.md)会虚拟化对 `HKCU` 的所有写入，因此浏览器永远看不到打包应用写入的键。于是该包声明了 `unvirtualizedResources` 受限功能，起初附带针对整个包的 `desktop6` 关闭选项，之后只排除 `%APPDATA%\Aeven` 和四个 `io.aeven.browser` 键，而这只有 Windows 11 支持。Microsoft 依据政策 10.6.3 三次拒绝了该功能，后两次分别在 2026-11-26 和 2026-11-27，措辞相同，尽管最后一次提交只排除一个文件夹和四个键，并写明了支持联系方式和网站。在 Windows 11 虚拟机上的测试确认，没有该功能，Store 版本无法注册该主机。

## 决定

桌面应用在 `127.0.0.1` 上为扩展提供一个 WebSocket（`apps/desktop/src/browser-extension.ts` 中的 `serveExtensions`，基于 `ws` 包），使用 `EXTENSION_PORTS`（47820、47821、47822）中第一个空闲的端口；扩展的 worker 按相同顺序尝试同一列表（`apps/chrome-extension/src/background.ts` 中的 `APP_PORTS`）。原生消息在两个方向上都与 WebSocket 并存，因此任意扩展版本与应用版本的组合都能连接。应用继续注册 `io.aeven.browser` 主机并提供其本地套接字（`serveNativeHost`），扩展 0.3.37 及更早版本就是这样连接它的；浏览器只为主机清单列出的扩展 id 启动该主机，因此这些连接无需配对。扩展保留 `nativeMessaging` 权限，并在没有端口应答时通过该主机连接，这就是它连接此变更之前的桌面应用的方式。请求和事件消息不变，每个文本帧承载一条 JSON 消息。

服务器只接受 `EXTENSION_IDS` 的 `chrome-extension://` 来源。之后双方证明各自持有一个 32 字节的配对密钥，应用把它保存在 `$AVN_HOME/desktop/browser-extension-secret`（权限 0600），扩展把它保存在 `chrome.storage.local`。应用发送一个随机挑战；扩展用 `extension:<port>:<challenge>` 的 HMAC-SHA256 作答，并附上自己的挑战；应用再用 `app:<port>:<对方的挑战>` 的 HMAC-SHA256 作答。只有到这一步，应用才接纳该套接字，扩展才为它服务。每个证明都包含端口，因此某个端口上的程序无法把这次交换转发给另一个端口上的应用。

无法证明密钥的扩展来源会被拒绝。随后应用在每个名称以扩展所报告名称开头、且装有该扩展的已安装浏览器中打开 `chrome-extension://<id>/connect.html#<secret>`，服务器运行期间每个浏览器最多一次，在 macOS 上于后台打开。该页面把密钥交给 worker，worker 保存密钥、发起连接，并关闭该页面及其历史记录。应用为代理启动浏览器时，也会把密钥放进该页面的片段。任何网页都不能打开该页面，因为它不是可供网页访问的资源，所以只有本机上的程序能为扩展配对。

连接期间，worker 每 20 秒发送一次 `{ event: 'ping' }`，因为 Chrome 会停止 WebSocket 空闲 30 秒的扩展 service worker；应用忽略该事件。

Store 包使用 electron-builder 自带的清单模板，除 `runFullTrust` 外不声明任何受限功能，要求 Windows 10 1809（`10.0.17763.0`）。`installer/appx/AppxManifest.xml` 和 `tests/store-manifest.spec.ts` 已删除。Store 安装仍会写入原生主机键，但写入的是浏览器不会读取的虚拟化注册表，因此扩展只能通过 WebSocket 连接它。

## 考虑过的替代方案

**直接取代原生消息。** 这样可以去掉第二种传输，但在两者都更新之前，扩展 0.3.37 及更早版本无法连接新应用，新扩展也无法连接旧应用；读者更新应用和扩展的时间并不相同。

**只检查来源，不做其他验证。** 任何本地程序都能发送任意 `Origin` 头，任何程序都能监听空闲端口，因此其他账户的程序或沙盒中的程序可以冒充扩展向代理提供页面内容，或冒充应用驱动读者已登录的浏览器。配对密钥封住了这两个方向。

**在应用中询问读者并信任第一个连接的扩展来配对。** 这需要新的界面，而且不能向扩展证明应用的身份，因此先占用端口的程序仍能驱动浏览器。

**Store 版本不带扩展。** Store 读者会失去一个在其他所有版本上都可用的功能。

**继续申请 `unvirtualizedResources`。** 三次相同的拒绝，加上 Microsoft 文档把该功能描述为面向游戏，没有理由期待不同的结果。

**在该功能下只排除文件夹和键，或排除整个 AppData。** 这是早先几次提交的设计。它们还会让代理的工具在 AppData 下写入未虚拟化的文件，例如 `npm install -g` 或其他程序的设置文件，而这些无法事先用排除列表列出。

## 影响

- Store 包重新可以安装在 Windows 10 上，其提交也不再需要为功能作说明。
- 在 Store 版本中，对 AppData 和 `HKCU` 的所有写入都落在包的私有存储中，包括代理的工具在那里写入的内容：代理之后的命令能看到，其他程序看不到，卸载该包时会被删除。Store 安装和 NSIS 安装各自保留配置，并可同时运行；后启动的那个在下一个端口上为扩展提供服务。
- 任意扩展版本都能连接任意桌面应用版本，因此扩展和桌面版本可以按任意顺序发布。要去掉原生消息，需要所有已安装的扩展和应用都已越过此变更。
- 当扩展没有密钥或持有过期密钥时，配对会在每个浏览器、每次应用运行中打开一次页面。页面会在浏览器启动时使用的配置文件中打开，因此只装在其他配置文件中的扩展要等代理下次启动该浏览器时才会配对；如果那个配置文件不是浏览器打开的那个，则永远不会配对。应用不知道如何启动的浏览器，例如 Opera 和 Vivaldi，不会被配对。
- 浏览器启动程序运行期间，密钥会出现在它的命令行中。Linux 允许其他账户读取命令行，除非 `/proc` 以 `hidepid` 方式挂载。
- Chrome 的本地网络访问限制从 Chrome 147 起管控指向回环地址的 WebSocket，其文档没有提到扩展。在 macOS 上的 Chrome 158 中，扩展的 service worker 无需权限提示即可连接；如果以后的 Chrome 把这些限制用于扩展，连接会在读者授予权限之前中断。
