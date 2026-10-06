# Agent Note：浏览器桥交出 Host 用户真正拥有的文件

Status: implemented

[English](2026-10-06-browser-bridge-declares-its-file-roots.md) | 中文

## 问题

Chrome DevTools MCP 的工具拒绝 OS 临时目录之外的任何文件路径。2026-10-06，一个会话要把生成的图片附加到 LinkedIn 草稿时做不到：`mcp__chrome_devtools__upload_file` 回答 `Access denied: path /Users/Mac/Downloads/meat-proxy.jpg (canonical: ...) is not within any of the configured workspace roots`，对会话正在其中工作的路径也是同样的回答。`take_screenshot` 的 `filePath` 以同样方式失败，会话连截图都存不下来。会话最后直接讲 CDP —— `Page.setInterceptFileChooserDialog`、对页面自身媒体控件的合成点击、`DOM.setFileInputFiles` —— 才完成工作，而任何会话都不该持有这种机械。

成因是服务器自身路径守卫的默认值，不是浏览器。`chrome-devtools-mcp` 用它的 MCP roots 校验每个路径，而 `McpContext.roots()` 回答的是连接客户端协商到的 roots 加上 `os.tmpdir()`。`@aeven/mcp-client` 构造 `new Client(..., { capabilities: {} })`，不声明任何能力，因此服务器的 `roots/list` 请求永远解析不了，客户端 roots 保持 undefined，守卫就只剩临时目录。服务器在初始化时会把这个回退写到 stderr；[Host 控制台那篇笔记](../architecture/2026-08-29-host-console-is-the-hosts.zh.md) 在测量别的事情时已经引过那一行。

## 决策

web-app bundle 中 `mcp-chrome-devtools` 这一行传入 `--workspace`，指向 Host 用户的主目录，取自 `process.env.HOME ?? process.env.USERPROFILE`。浏览器桥可以交出运行它的那个账户之下的一切 —— Downloads、Desktop、工作区目录、`~/.aeven` —— 之外则不交：系统路径、其他账户的主目录、挂载卷仍被拒绝。

上游已弃用 `--allow-unrestricted-paths`，主张改用 `--workspace=/`，而那个替代值行不通。包含性检查接受等于 root、或以 `root + path.sep` 开头的路径，对 `/` 来说就构造出 `//` 前缀，于是没有任何真实路径能匹配。对着运行中的服务器验证过：`--workspace=/` 复现了拒绝，而 `--workspace=/Users` 与 `--workspace=$HOME` 都回答 `File uploaded from /Users/Mac/Downloads/meat-proxy.jpg.`

## 测试

`packages/bundle/web-app/tests/browser-bridge-roots.spec.ts` 钉住这一行：该参数及其计算值、`--allow-unrestricted-paths` 与 `--workspace=/` 都不存在、以及表达式从 `HOME` 解析并在 `HOME` 未设置时从 `USERPROFILE` 解析。删掉那两行参数会让它的三个用例中的两个失败，因此该 spec 是随缺陷一起失败，而不是在缺陷旁边失败。

在 spec 存在之前，行为是对着真实服务器测的：像 `@aeven/mcp-client` 那样（不声明 roots 能力）通过 stdio 启动 `chrome-devtools-mcp`，打开一个带 `file` 输入的页面，为它取快照拿到 uid，再用 `/Users/Mac/Downloads/meat-proxy.jpg` 调用 `upload_file`。没有该参数时，调用回答 `Access denied: path /Users/Mac/Downloads/meat-proxy.jpg (canonical: ...) is not within any of the configured workspace roots`；带 `--workspace=$HOME` 时回答 `File uploaded from /Users/Mac/Downloads/meat-proxy.jpg.` `--workspace=/` 那次在同版本服务器（1.10.1）与 9333 端口上的同一个浏览器上复现了拒绝，正是它指出了 `//` 前缀这个成因。

`pnpm run verify-cordis-config` 通过打补丁后的 bundle 配置。该计算参数是携带 `!!js` 的数组元素，Loader 在行自身的 fiber 中解析它 —— SDK 快照配置对它们自己的计算参数列表已经采用这一安排。

## 考虑过的替代方案

**`--allow-unrestricted-paths`。** 它精确恢复守卫之前的行为，也是服务器自身警告建议的参数，但上游把它标为弃用，所以它是下次升级要删掉的一行，而不是一个要保留的决定。

**`--workspace=/`。** 上游给出的替代值，也是读者会伸手去拿的值。如上所测，它根本无法匹配任何路径。在这里采纳上游的建议看起来正确，却什么都不会改变。

**给 `@aeven/mcp-client` 加上 `roots` 能力并回答 `roots/list`。** 这是符合协议的修法，并把一份 root 清单放进客户端，让每个 MCP 服务器共享。它也让每个服务器的文件访问取决于客户端就 Host 文件系统形成的意见，而客户端没有依据形成这种策略；知道自己在启动浏览器桥的那一行，才是携带该 root 的那一行。

**`--workspace=/Users`。** 能通过，并覆盖 macOS 部署。它是本项目为 macOS、Linux 与 Windows 构建的配置里的平台字面量，而同一账户的数据在 `/home` 与 `C:\Users` 下。

**继续让会话使用 CDP。** 它奏效了，代价是每个未来的会话都要付出同样的二十分钟和同样的手写拦截，而且失败读起来像工具坏了，而不是服务器默认值错了。

## 后果

上传与截图写入现在覆盖会话真正处理的文件，服务器关于未协商 roots 的初始化警告也不再出现。守卫仍然拒绝 Host 用户自己账户之外的一切，因此从挂载卷上传需要扩展该行的 `--workspace`，而不是靠会话绕道。

这个守卫从来不是保护机器的边界：该行以 Host 用户身份从 npm 拉起 `chrome-devtools-mcp@latest`，而约束 agent 自身文件与 shell 工具的文件系统策略是 [`@aeven/fs`](../../../../packages/fs/fs/README.zh.md) 及其沙箱，这一行并不咨询它。指明账户目录让上游的检查仍有意义 —— 其外的路径仍被拒绝 —— 同时不假装它是安全控制。

Host 在下次启动时才会拿到它：该行在 bundle 加载时启动一次，因此运行中的 Host 会保留旧参数，直到重启。
