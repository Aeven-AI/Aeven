# Agent Note：托管 jail 挂载对话已加载技能的资源

Status: implemented

[English](2026-11-20-hosted-jails-mount-loaded-skill-resources.md) | 中文

## 问题

在 Aeven Cloud 上，技能的指令无法打开它自己的文件。`@aeven/host-account-integrations` 把已安装技能的资源写到 `<avn home>/accounts/<account>/skills/<name>/<revision>/`，这是宿主用户拥有的 `0700` 目录。jail 中的命令只能看到只读系统、`/opt/aeven-sandbox`、其账户文件夹以及 aeven 预设自带的技能，并以 `aeven-sandbox` 身份运行，无法进入宿主的数据目录；受限的 `read` 工具也只打开对话文件夹及其引用的附件。因此，每个带有参考资料、剧本或脚本的目录技能在云端对话中都会失败，而同一技能在桌面端可以工作：`poteto-mode` 读不到任何剧本或原则，`statechart` 和动效技能也读不到各自的文件。

## 决定

两条加载路径都在面向模型的文本之外记录资源目录。`skill` 工具的 `presentationMeta` 在其持久化的 `tool/result` 上写入 `meta.resourceDirectory`，`/name` 调用的 `SkillInvocationSource` 携带 `resourceDirectory`。`@aeven/skill` 中的 `loadedSkillDirectories()` 只读取这些记录，并且只读取调用 id 属于日志中某个 `skill` 工具调用的 `tool/result`，因此技能正文和其他工具的 meta 都无法指定目录。

`@aeven/sandbox-jail` 的 `sessionSkillResources: { maxFiles, maxBytes }` 把这些目录下的每个普通文件以只读方式按原路径挂载到每条命令中，所用的描述符复制机制与 jail 已用于附件的相同：宿主用户打开每个文件，再由 bubblewrap 复制进来，因此沙箱用户无需访问宿主的目录。所有者可执行的文件以 `--perms 0555` 复制，这与 account-integrations 把以 `#!` 开头的资源写为可执行文件相配合，使内置启动脚本可以按路径运行。超出任一上限的文件不挂载，宿主会记录日志。`@aeven/tool-fs` 的 `confineToWorkspace` 也允许读取这些目录下的文件。托管 bundle 设为 512 个文件和 32 MiB。

## 考虑过的替代方案

**把技能资源写进账户文件夹。** jail 和受限的 `read` 无需新的挂载就能看到它们，但宿主随后会向 jail 命令可控的目录写入，被替换进来的符号链接会重定向写入；托管组合正是出于这个原因让宿主不写入账户文件夹。

**把每个账户的技能目录绑定进其 jail。** 每条命令一次绑定比逐文件复制更省，但沙箱用户无法遍历宿主的 `0700` 目录树，因此需要像账户文件夹那样的第二个带 ACL 授权的挂载，并在每个部署上做宿主配置。

**从日志文本中解析 `Base directory for this skill:`。** 同一段文本携带技能正文，而账户可以从任何地方导入技能，因此正文可能指向另一个账户的目录。

**挂载账户已安装的全部技能。** 无需扫描日志，但每条命令都会复制每个已安装的技能，而其中大多数对话并未使用。

## 影响

加载了技能的对话在之后的每条命令上为每个资源文件付出一次复制，受所配置的上限约束；没有资源文件的技能不产生开销。资源目录按修订版划分且永不改变，因此每个目录在每个宿主进程中只列出一次。记录只存在于此变更之后的加载中；更早加载过某技能的对话在再次加载该技能后才会重新挂载它。
