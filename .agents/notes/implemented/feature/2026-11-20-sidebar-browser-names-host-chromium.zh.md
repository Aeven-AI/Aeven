# Agent Note: 侧边栏浏览器的打开控件始终可见并显示 Host Chromium 的名称

Status: implemented

[English](2026-11-20-sidebar-browser-names-host-chromium.md) | 中文

## Problem

桌面侧边栏浏览器的 `open-in-chrome` 控件会在 Host 的 Chromium 中打开页面，即 `chrome-devtools-mcp` 驱动的远程调试配置文件。该控件只在指针悬停于地址栏上时显示，并在地址栏获得焦点时被卸载，因此读者一点进地址栏它就消失，地址栏获得焦点时 `browser_control open-in-chrome` 也会失败。它的提示始终写着「在 Chrome 中打开」，但未安装 Chrome 和 Chromium 时 Host 启动的是 Edge。可执行文件搜索只能找到 Chrome、Chromium、Chrome Canary 和 Edge，Brave、Vivaldi 和 Opera 用户必须设置 `executablePath` 或 `AVN_CHROME_PATH`。

## Decision

只要页面有 URL，`ChromeRow` 就渲染该控件，无论地址栏是否获得焦点，且没有悬停规则；地址文本始终为控件预留宽度。控件上的 `mousedown` 被阻止，因此正在输入的草稿保持焦点并在点击后保留；控件打开的是已加载的页面，而不是草稿。

`avn-browser-chromium` 在原有候选之后，搜索 Brave、Vivaldi 和 Opera 在 macOS、Windows 以及 `PATH` 上的安装位置。新的 `describe` 远程方法返回 `BrowserChromiumIdentity`，其可选的 `name` 是根据所解析可执行文件的小写文件名（去掉 `.exe`）查得的产品名称（"Chrome"、"Chrome Canary"、"Chromium"、"Edge"、"Brave"、"Vivaldi"、"Opera"），配置的路径和搜索到的路径都适用。侧边栏浏览器在远程挂载时调用一次 `describe`，并将控件标记为「在 {browser} 中打开」；未知文件名或没有浏览器的 Host 标记为「在浏览器中打开」。文案提供英文、中文和西班牙语版本。

## Alternatives considered

- **把名称加入 `status`。** `avn-tool-browser` 会为模型的报告采样 `status`；在其中加字段会为了面向读者的标签而改变模型可见的报告。
- **只在地址栏未获得焦点时显示控件，但保持挂载。** 报告的故障正是控件在读者编辑地址时消失；任何依赖焦点的可见性都会重现它。
- **从可执行文件所在目录或应用包元数据推断浏览器名称。** 文件名在三个平台上都能识别每个受支持的浏览器，无需读取应用包。

## Consequences

已加载页面上的控件始终存在，代理的指针也能按到它。提示显示点击会到达的浏览器。文件名不在表中的浏览器在配置后仍可启动，并使用通用标签。打开的目标仍是位于 `<AVN_HOME>/runtime/chrome-profile` 的共享调试配置文件；把页面交给读者日常使用的浏览器是 issue #742 中的另一项提案。

## Testing

`pnpm run check:ci` 和 `pnpm run test` 在干净分支上通过。没有 spec 覆盖该标签或可执行文件表；标签只经过类型检查和构建验证。
