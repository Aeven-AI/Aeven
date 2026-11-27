# Aeven 浏览器扩展

[English](README.md) | 中文

让 Aeven 代理使用你日常浏览所用的浏览器——Chrome、Brave、Edge、Arc 或其他 Chromium 浏览器——无论是从 Aeven 桌面应用还是从网页版 Aeven。

- 代理在前台打开自己的标签页，放在一个展开的 **Aeven** 标签组中，并且只驱动这些标签页，使用与侧边栏浏览器相同的工具、等待和指针。扩展自己运行每个完整的操作。
- 代理操作时 Chrome 会显示“Aeven 已开始调试此浏览器”；代理在某个标签页最后一次操作 10 秒后，扩展会从该标签页分离，提示条随之消失。
- 经你审批后，代理会搜索你的历史记录和书签。
- 桌面应用在 `127.0.0.1` 上为扩展提供一个 WebSocket，使用 47820、47821、47822 中第一个空闲的端口，除非读者在“设置 > 通用”中关闭了**浏览器扩展**；关闭后服务器随之关闭。服务器只接受扩展的 `chrome-extension://` 来源，之后双方证明各自持有 `$AVN_HOME/desktop/browser-extension-secret` 中的配对密钥：每一方都用 HMAC-SHA256 对另一方的随机挑战和端口签名，因此不持有密钥而监听或连接该端口的程序，或在两个端口之间转发的程序，都无法冒充任何一方。没有密钥的扩展会被拒绝，应用随即在每个同名且装有该扩展的已安装浏览器中打开片段携带密钥的 `connect.html`，应用运行期间每个浏览器只打开一次；该页面把密钥交给 worker，worker 保存密钥、发起连接，并关闭该页面及其历史记录。只有本机上的程序能打开该页面，因为任何网页都不能导航到它。应用还会继续向每个已安装的 Chromium 浏览器注册其原生消息主机（`io.aeven.browser`），并提供该主机的本地套接字，因此使用 WebSocket 之前的扩展（0.3.37 及更早）仍能连接：在 Windows 上写入 Chrome、Chromium、Brave 和 Edge 的 `HKCU\Software\<browser>\NativeMessagingHosts\io.aeven.browser` 键，在其他平台写入每个浏览器 `NativeMessagingHosts` 文件夹中的主机清单。关闭**浏览器扩展**会删除它们，Windows 安装程序的卸载程序也会删除这些键。Microsoft Store 安装会把这些键写入其私有的虚拟化注册表，浏览器不会读取那里，因此扩展只能通过 WebSocket 连接它。没有端口应答时，扩展改为通过原生主机连接，这就是它连接使用 WebSocket 之前的桌面应用的方式。可以同时连接多个浏览器；每个安装都有自己的 id，代理的标签页 id 带有它。没有浏览器连接而代理要打开标签页时，应用会启动装有扩展的浏览器并打开 `connect.html`，以唤醒扩展。应用连接期间，worker 每 20 秒发送一条消息，使 Chrome 保持它运行。
- `aeven.io` 上的 Aeven 网页直接连接扩展（`externally_connectable`），托管版 Aeven 由此使用你的浏览器。localhost 页面只能连接未打包的开发版安装。
- 从 [Chrome 应用商店](https://chromewebstore.google.com/detail/aeven/cpgmlafibkmklfnpjpjbdgoegpljfofa)安装（id `cpgmlafibkmklfnpjpjbdgoegpljfofa`）。托管版 Aeven 需要你的浏览器而扩展缺失时，页面会链接到这个商店页面，并在扩展添加后立即继续；页面无需重新加载即可发现新安装。

## 构建与加载

```sh
pnpm --filter @aeven/chrome-extension build
```

打开 `chrome://extensions`，开启开发者模式，选择 **加载已解压的扩展程序**，然后选择 `apps/chrome-extension/dist`。manifest 中的 `key` 固定了主机 manifest 所允许的扩展 id（`jagdfmhjejiccpmnfieenehhijhjjgnf`）。
