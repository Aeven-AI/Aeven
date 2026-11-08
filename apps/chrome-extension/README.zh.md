# Aeven 浏览器扩展

[English](README.md) | 中文

让 Aeven 代理使用你日常浏览所用的浏览器——Chrome、Brave、Edge、Arc 或其他 Chromium 浏览器——无论是从 Aeven 桌面应用还是从网页版 Aeven。

- 代理在前台打开自己的标签页，放在一个展开的 **Aeven** 标签组中，并且只驱动这些标签页，使用与侧边栏浏览器相同的工具、等待和指针。扩展自己运行每个完整的操作。
- 代理操作时 Chrome 会显示“Aeven 已开始调试此浏览器”；代理在某个标签页最后一次操作 10 秒后，扩展会从该标签页分离，提示条随之消失。
- 经你审批后，代理会搜索你的历史记录和书签。
- 桌面应用通过其原生消息主机（`io.aeven.browser`）连接扩展，并在启动时向每个已安装的 Chromium 浏览器注册该主机。可以同时连接多个浏览器；每个安装都有自己的 id，代理标签页的 id 带有它。没有连接且代理要打开标签页时，应用会启动装有扩展的浏览器并打开 `connect.html`，以唤醒扩展。不会打开任何网络端口。
- `aeven.io` 上的 Aeven 网页直接连接扩展（`externally_connectable`），托管版 Aeven 由此使用你的浏览器。localhost 页面只能连接未打包的开发版安装。

## 构建与加载

```sh
pnpm --filter @aeven/chrome-extension build
```

打开 `chrome://extensions`，开启开发者模式，选择 **加载已解压的扩展程序**，然后选择 `apps/chrome-extension/dist`。manifest 中的 `key` 固定了主机 manifest 所允许的扩展 id（`jagdfmhjejiccpmnfieenehhijhjjgnf`）。
