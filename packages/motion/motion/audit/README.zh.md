# Motion 审计脚本

[English](README.md) | 中文

动态影片渲染器为测量打包后的 HyperFrames 合成而加入其中的浏览器脚本。`src/audit.ts` 加载这两个脚本，并判定它们返回的内容。

| 文件 | 来源 |
|---|---|
| `layout-audit.browser.js` | 原样复制自 npm 包 `hyperframes` 0.9.99 的 `dist/commands/layout-audit.browser.js`（[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)，Apache-2.0）。它定义 `window.__hyperframesLayoutAudit` 与 `window.__hyperframesCraftSample`。 |
| `driver.browser.js` | 我们自己的脚本。它定义 `window.__avnMotionAudit(times)`：把合成的播放器定位到每个时间，调用上面两个函数，并报告以回退字体渲染的字体族。 |

## 更新上游脚本

与 `@hyperframes/*` 包一起更新，并更新到同一版本：

1. 在空的临时文件夹中运行 `npm pack hyperframes@<version>` 并解包。
2. 把 `package/dist/commands/layout-audit.browser.js` 原样覆盖到此处的文件。
3. 修改上表中的版本号。
4. 审阅一部已知有问题的影片，确认其发现不变；驱动脚本读取每个问题的 `code`、`severity`、`selector`、`text`、`message` 与 `fixHint`，以及每个 craft part 的 `key`、`block`、`selector`、`text`、`blockText`、`opacity`、`fontPx` 与 `captions`。
