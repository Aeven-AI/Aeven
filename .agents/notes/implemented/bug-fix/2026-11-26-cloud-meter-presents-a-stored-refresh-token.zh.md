# Agent Note：云端用量报告要等页面续签令牌

Status: implemented

[English](2026-11-26-cloud-meter-presents-a-stored-refresh-token.md) | 中文

## 问题

2026-11-26，托管 Host 自 2026-11-14 起为七个账户每分钟记录一次 `cloud usage reports of <owner> wait: the Aeven API answered 401`，每个账户每天最多 1,440 次。自 2026-11-20 起，API 记录了 7,988 行 `cloud.meter.charge_failed`，内容为 `the Æven credential is invalid or expired`。`cloud-meter` 出示 `AEVEN_TOKEN`，而在托管 Host 上，该引用只解析为连接从账户最近一次请求中发布的 access token。access token 在页面最后一次续签两小时后过期，因此账户没有打开的页面时，其沙箱和存储报告会排在内存中，直到账户回来。重启会丢弃它们，而收到 401 的额度查询会放行该账户的云端工作。

另外，有四个账户的存储很少被计费。`du -sk` 无法进入某个目录时以 1 退出，而沙箱命令会创建属于 `aeven-sandbox` 的 `0700` 目录，例如 `chats/.aeven-previews` 下的 `mkdtemp` 文件夹和 `chats/.cache/libreoffice-kit`。计量器把这种退出当作测量失败，不排队存储报告，因此一个 3.8 GB 的账户自 2026-11-11 以来只有一天被计了存储费。

## 决定

- `UserResolver.unattendedCredential` 让 authority 声明它从请求中读取的长期凭据。`identity-user-aeven` 在 `refreshToken` cookie 验证为与请求相同的用户时，以 `unattendedCredentialRef`（`AEVEN_REFRESH_TOKEN`）读取它。
- 在支持账户存储的凭据提供方上，连接在该凭据的值变化时，把它保存到调用方的账户凭据文件中。没有账户存储的 Host 不保存任何内容，因为其凭据文件由所有调用方共享。
- `cloud-meter` 以 `credentialRefs` 取代 `credentialRef`，按顺序出示每个凭据，直到 API 不再回答 401。托管 bundle 写明 `[AEVEN_REFRESH_TOKEN, AEVEN_TOKEN]`。只要账户还有任何有效会话，API 就接受 refresh token 作为 `/api/cloud/meter` 的 bearer（`INFERENCE_ALLOW_REFRESH_CREDENTIAL`，`sessionMatch: any`），因此浏览器之后轮换过的令牌仍然有效。
- `du` 以 1 退出时，`cloud-meter` 采用它打印的总量，不可读的目录不计入。

## 考虑过的方案

- **让 Host 续签 access token。** 否决：`/refresh-token` 会轮换 refresh token 并拒绝被替换的那个，因此 Host 的交换会让浏览器退出登录。
- **把 refresh token 发布为 `AEVEN_TOKEN`。** 否决：该引用的其他使用方调用只接受 access token 的端点，而交给账户桌面端的会话凭据会带上有效期一年的令牌。
- **持久化报告队列。** 延后：有了比页面存活更久的凭据，报告只会在 API 不可达或账户在所有地方都退出登录时等待。
- **以沙箱用户身份测量存储。** 否决：Host 用户无法切换用户，而不可读的目录是临时文件夹和缓存。

## 后果

本变更之后，托管账户的凭据文件从其第一次请求起保存其 refresh token。该文件权限为 `0600`，位于 Host 私有的账户文件夹下，不包含在账户导出中，并在账户被删除时移除。退出登录不会移除它；账户没有有效会话时 API 会拒绝它。经 `llm-aeven` 的模型请求仍只出示 `AEVEN_TOKEN`。
