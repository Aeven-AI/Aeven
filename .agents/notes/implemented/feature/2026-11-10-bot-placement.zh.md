# Agent Note：Bot 在其任务可以运行的地方运行

Status: implemented

[English](2026-11-10-bot-placement.md) | 中文

## 问题

Bot 的定义会同步到其账户的每一台 Host，而托管 Host 也是其中之一。任何持有该定义租约的 Host 都会受理它的计划运行：对于已同步的账户，`runsHere` 对每台 Host 都返回 true，并忽略 `executionTarget`。因此，托管 Host 可能接手一个读取用户电脑上文件夹的 Bot 并让每次运行都失败，而笔记本电脑可能接手一个只读取邮件的 Bot，合上盖子后就不再运行。定义中没有任何内容说明任务需要什么，所以没有 Host 能作出别的决定，`/bots` 页面也无法说明 Bot 在哪里运行。

## 决策

定义携带任务需要从所有者自己的电脑获得的能力以及所有者的选择，每台 Host 用同一个纯函数由此推导运行位置（[`placement.ts`](../../../../packages/core/automations/src/placement.ts)）。

- **需求。** `requires` 列出设备能力：`files`、`browser`、`computer-use`。`automation_create` 要求模型声明它，所有者在已经覆盖任务的那次批准中确认它。运行使用的其他一切（网页搜索、已连接的账户、运行自己创建的文件）在每台 Host 上都存在，无需声明。
- **所有者的选择。** `runOn` 为 `auto` 或 `device`。对于不需要电脑上任何能力的 Bot，`/bots` 页面可以切换它。
- **Host 画像。** 组合配置为每台 Host 提供 `placement.kind`（`cloud` 或 `device`）和 `placement.provides`。Web bundle 是提供全部三种能力的 `device`；托管 bundle 是不提供任何能力的 `cloud` Host。
- **推导出的运行位置。** 没有需求且 `runOn: auto` 的 Bot 在云端 Host 上运行。有任何需求或 `runOn: device` 的 Bot 在提供全部需求的设备 Host 上运行。在本次变更之前保存、没有 `requires` 的定义仍像以前一样可在任意 Host 上运行。云端、设备和混合都是这一推导的结果；定义不保存其中任何一个。
- **强制执行。** `admit` 在运行位置排除的 Host 上拒绝计划运行、手动运行和入站运行，调度器也不会在那里申请租约。
- **云端优先，设备作为后备。** 每台 Host 都把自己的画像写入账户同步文档 `automations` 的 `hosts` 映射。该映射中没有云端 Host 时，设备 Host 立即受理放在云端的 Bot。否则它等待 `sync.fallbackDelayMs`（两分钟），并且只在定义同步的 `lastAdmittedAt` 显示云端 Host 未受理时受理，随后放弃租约。
- **页面。** 每张 Bot 卡片显示第三项信息“运行位置”，展开的卡片说明原因并提供 `runOn` 开关。

`automations` 领域保持版本 3：读取已保存的定义时，这两个字段是可选的或带有默认值，因此现有 Bot 无需改动即可打开。

## 备选方案

保存 Bot 类型（`local`、`cloud`、`hybrid`）的方案被否决：任务或账户的 Host 发生变化时都需要改写它，而混合是一次使用两台 Host 的运行的属性，不是定义的属性。

让模型选择 Bot 在哪里运行的方案被否决。模型说明任务需要什么，所有者可以阅读并确认；由 Host 作出决定，提示词无法把 Bot 移到缺少某项能力的 Host 上。

从 Host 上挂载的工具推导 `provides` 的方案被否决：这些工具由多个包注册，有些要在用户启用后才注册，因此答案会在 Host 运行期间变化。

为判断云端 Host 是否存活而让每台 Host 发送心跳的方案被否决：它每分钟都要写入每个账户的文档。共享的受理水位已经能显示云端 Host 是否受理了某次触发。

## 影响

运行位置信任声明。声明时未包含 `files` 却读取本地文件的 Bot 会在云端失败，没有任何机制把运行中的工具调用与 `requires` 核对。

需要电脑的 Bot 不会在云端启动，托管页面也拒绝手动运行它。让云端运行使用设备上的文件是这条路径上的下一项变更，见[后续阶段](../../proposed/feature/2026-10-12-automations-next-phases.zh.md)。

云端 Host 已登记但已停止的账户，其放在云端的 Bot 会晚两分钟由设备运行。Host 不会从 `hosts` 映射中移除。

较旧的构建会拒绝带有 `requires` 或 `runOn` 的定义，因此尚未更新的设备不再接收在已更新设备上创建或修改的 Bot。

本次变更没有重新生成 cordis API 目录：`gen-cordis-api` 会在同一检出中未提交的沙箱工作里的一个类型处停止。

## 验证

在开发版桌面应用中，以已同步的账户登录，Host 打开了现有的版本 3 `automations` 领域。一条消息请求创建两个 Bot：模型为每日网络新闻简报声明了 `requires: []`，为每日检查“下载”文件夹声明了 `requires: ["files"]`，两者都在批准后创建。`/bots` 页面在两张卡片上都显示“运行位置：你的电脑”。展开的新闻卡片显示“此Bot在你的电脑上运行，电脑上的 Aeven 打开时才会执行。”，因为该账户还没有登记云端 Host；它的开关把 `runOn` 改为 `device` 再改回，文字随之变化。“下载”卡片把“你的文件”列为原因，并且不提供开关。`pnpm run build` 通过。尚未观察到运行本次变更的云端 Host：托管部署还不包含它，因此云端优先受理和两分钟后备在真实 Host 上未经验证。
