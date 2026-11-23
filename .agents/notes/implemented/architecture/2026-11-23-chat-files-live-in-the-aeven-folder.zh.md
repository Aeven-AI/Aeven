# Agent Note: 聊天文件存放在 Aeven 文件夹中

Status: implemented

[English](2026-11-23-chat-files-live-in-the-aeven-folder.md) | 中文

## 问题

一位用户请 Aeven Cloud 把五张照片裁剪拼成一张商品图（[issue 761](https://github.com/Aeven-AI/Aeven/issues/761)）。该云端会话位于账户没有文件夹的 Chats 工作区中，因此托管 Host 在其托管文件夹 `sandbox/accounts/<account>/workspaces/<chats id>/` 中运行它，图片也写在那里。没有任何文件同步文件夹覆盖该路径：托管 Host 只共享账户的 Aeven 文件夹（位于 `aeven-folders/<account>`），而它的会话无法写入该文件夹（[Aeven 文件夹会同步](../feature/2026-11-16-synced-aeven-folder.zh.md)）。在用户的 Mac 上，同一对话按 `~/.aeven/chats` 解析相对路径，这是桌面为没有文件夹的聊天准备的目录，同样没有被同步。点击产出文件弹出 `path open failed: path open failed: Command failed: open …`，而回复按云端路径嵌入的图片显示为链接。桌面在没有项目的聊天中制作的文件只保存在那台机器上，丢失机器就会丢失这些文件。

## 决定

没有自己文件夹的聊天在每台设备上都在账户的 Aeven 文件夹内工作，布局一致：未归档的会话用 `chats/`，归入没有文件夹的工作区（如 Chats）的会话用 `workspaces/<workspace id>/`。

- **托管。** 设置 `AVN_HOSTED_SANDBOX=1` 时，`aeven-folder-sync` 以 `perAccount` 使用 `sandbox/accounts`，因此每个账户的托管文件夹（其受限命令唯一能看到、也由其磁盘配额覆盖的文件夹）就是它的 Aeven 文件夹。云端会话制作的文件会到达账户的桌面设备和文件云。`advertise` 仍为 false：受限命令只能看到其会话的子文件夹，看不到该文件夹的根目录。
- **桌面。** 对于未记录目录、或位于没有文件夹的工作区中的会话，`working-directory` 通过新的 `working-directory/account-folder` bail 事件询问，当本设备的文件夹属于该账户时，`aeven-folder-sync` 回答账户的 Aeven 文件夹。会话随即在 `~/Documents/Aeven` 下使用同样的布局工作，另一台设备运行的对话也在文件同步带到本机的副本中解析其相对路径。没有回答时（例如设备的文件夹已被另一个账户认领时的第二个账户），会话不记录目录，继续使用沙箱策略的 `~/.aeven/chats`。认领无主文件夹是同步的，因此目录解析仍保持同步。
- **忽略规则。** 默认的文件同步忽略规则新增 `.npm`，受限命令的主目录会在其工作区内缓存它。
- **查看产出图片。** 轮次尾部以完整图片显示产出的图片，有记录的存储副本时来自该副本，方式与生成图片相同：单张保持自身比例，多张平铺。`produced-images` 轮次数据索引列出这些图片，因此已关闭轮次的回复若按路径或按 `reply-images/stored` 记录的副本嵌入其中某张，会把它留给尾部。
- **打开缺失的文件。** `session/openWorkspacePath` 把在不存在任何东西的路径上发生的打开器失败归类为 `session/path-missing`，其他失败则报告打开器的 stderr，而不是 `Command failed:` 那一行。聊天视图的文件打开器不再给 Host 消息加前缀。有存储副本的产出文件在路径缺失时下载该副本；否则对话框写出文件和文件夹，并提供打开该文件夹，而不是一个不可能成功的重试（[文件打开失败对话框](../bug-fix/2026-08-18-tool-row-file-open-failure.zh.md)）。只写出恰好一个产出路径末尾的正文链接会打开该路径。

## 考虑过的替代方案

**把 `aeven-folders/<account>` 作为第二个可写根挂载进监狱。** 这样每个账户有两个文件夹，一个在配额内、一个在配额外；除非监狱的账户边界也随之移动，云端聊天仍会写入托管文件夹。让托管文件夹成为 Aeven 文件夹不需要新的挂载，并让每次云端写入都在配额之内。

**让云端加入每个工作区的文件同步文件夹。** 这能携带项目的文件，但没有文件夹的 Chats 工作区中的聊天没有可加入的工作区文件夹，而这个文件正是写在那里。项目工作区的这一方案仍然开放。

**在桌面配置中把 `~/.aeven/chats` 本身移进 Aeven 文件夹。** 沙箱策略的根是整台设备的一个路径，因此多账户桌面的每个账户都会写入拥有该文件夹的账户的文件夹，其文件会同步到那个账户的设备上。

**把每个产出文件复制到附件存储并在点击时还原。** 附件按对话划分且有上限；它们继续用于聊天所展示的内容，文件由文件夹携带。

## 后果

在桌面或 Aeven Cloud 上于没有项目的聊天中制作的文件，会到达账户的每台设备和文件云，丢失机器不再丢失这些文件。桌面的 `~/Documents/Aeven` 中会出现 `chats/` 与 `workspaces/<workspace id>/` 文件夹，以 id 而不是工作区名称命名。云端账户同步的 Aeven 文件夹现在计入其 5 GiB 的监狱配额。在托管 Host 上，Aeven 文件夹从 `aeven-folders/<account>` 移到 `sandbox/accounts/<account>`。新构建启动前，必须在 Host 停止时把每个账户现有的文件夹内容（包括 Syncthing 的 `.stfolder` 标记）移入托管文件夹；否则 Syncthing 会发现其已索引的文件不存在，并把删除发送给桌面设备。托管数据导出会两次列出托管文件夹，一次作为聊天文件，一次作为 Aeven 文件夹。桌面的运行时上下文会为这些聊天写出一个工作目录，而以前没有。

## 验证

`pnpm run typecheck` 与 `pnpm run build` 通过。`session-open-workspace-path.host.spec.ts` 覆盖 `session/path-missing` 的归类，`file-links.client.spec.ts` 覆盖打开产出路径的链接。
