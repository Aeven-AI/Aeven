# Agent Note：托管云端工作被计量并从账户额度中计费

Status: implemented

[English](2026-11-11-cloud-usage-billing.md) | 中文

## 问题

Aeven Cloud 为任何账户运行沙箱命令、保存账户文件夹并运行轮次，且不收费。账户可以购买一美元额度，然后选用自己的模型密钥或免费提供方，继续免费使用托管沙箱、其存储和云端机器人。只有 Aeven 模型的推理会消耗额度。

## 决策

云端工作在推理之外另行计费，使用同一份额度：先扣套餐额度，再扣购买的余额。

- Aeven API（Nodejs-Server #149）按 `inference_config` 中的 `cloud` 部分为云端工作定价，运维人员像编辑套餐和费率卡一样编辑它。随附价格为：沙箱 CPU 每小时 0.10 美元，按秒计费；超出 1 GiB 的存储每 GiB 每月 0.10 美元，按天收取；在其推理不由它计费的提供方上，每个轮次 0.002 美元。套餐折扣为免费版 0%、pro 20%、heavy 30%、superheavy 40%，并低于相对实测 OCI 成本的利润率。Aeven 模型上的轮次不收云端费用。
- `avn-sandbox-jail` 从账户 cgroup 的 `cpu.stat` 中读取各账户的 CPU 时间，以 `sandbox-jail/usage` 报告，并在限制命令之前询问 `sandbox-jail/admit`。用 CPU 时间取代墙钟时间，是因为账户 cgroup 能精确计数，包括移入该组的 Python zygote 运行，而 `confine()` 看不到命令退出。
- `@aeven/cloud-meter` 用所有者的 `AEVEN_TOKEN` 把沙箱、存储和轮次报告发送到 `POST /api/cloud/meter/charges`，所用 id 使重发的报告只计费一次。API 报告为未付费的账户不能启动沙箱命令，也不能在不计费的提供方上开始轮次。托管组合包在 `AVN_CLOUD_BILLING=1` 时挂载它，因此只有在 API 提供计量接口之后才会开启。
- API 不可达时放行云端工作并保留排队的报告，与推理网关在 Redis 不可达时的选择相同。

## 后果

在用户桌面上运行的远程轮次不是云端工作，不会被计量。排队的报告保存在内存中，因此 Host 重启最多丢失一个间隔的 CPU 秒数。
