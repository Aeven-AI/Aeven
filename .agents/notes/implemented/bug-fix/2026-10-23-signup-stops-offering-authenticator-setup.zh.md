# Agent Note: 注册不再提供身份验证器设置

Status: implemented

[English](2026-10-23-signup-stops-offering-authenticator-setup.md) | 中文

## 问题

命名步骤在保存读者的名字之后请求 `GET /mfa/status`，以决定是否提供身份验证器注册，从而把一项安全决策放在新读者与产品之间。这个提供还让「名字已保存」依赖某条部署未必提供的路由：早于身份验证器工作的 API 会用该步骤的失败状态来回应一个已保存的名字，直到该步骤把无法回答的状态当作「没有保护」为止（[命名步骤挺过缺失的 MFA 状态路由](2026-10-15-naming-step-outlives-a-missing-mfa-status-route.zh.md)）。注册在账户设置中即可抵达，那里的安全段落描述了它，并且它自己的设置调用也在那里运行。

## 决策

`NameCheck` 保存名字并调用 `onNamed()`。该步骤不再请求 `/mfa/status`，不持有注册提供状态，也不渲染任何身份验证器表单；被拒绝的 `/set-display-name` 仍会触发该界面的弹窗，并让读者留在该步骤。

`MfaForm` 接受 `mode: 'setup' | 'disable'`，并为两者渲染同一个主体。`offer` 模式、它的说明段落以及它的主按钮与稍后按钮都不存在，`MfaKey` 也不再包含 `mfa.intro`、`mfa.setup` 与 `mfa.skip`。`ui-auth-aeven` 与 `ui-account-aeven` 两个词典的英文、中文与西班牙文表中都已删除这三个键。

账户设置是唯一的注册入口：`AccountSection` 以 cells 布局渲染 `MfaForm`，`mode` 取 `setup` 或 `disable`，并在旁边保留经确认的开启/关闭状态；其 `security.info` 文案说明登录时需要身份验证器应用中的验证码。

## 考虑过的替代方案

**在命名步骤中保留该提供与状态调用。**该步骤的职责是名字，而注册在设置中已经可达，因此这个提供给注册流程增加了第二个决策，并让已保存的名字依赖部署未必提供的状态路由。

**为后续调用方保留 `MfaForm` 的 `offer` 模式。**命名步骤不再渲染它之后，没有任何组合传入 `mode: 'offer'`；保留它只会留下一个不可达的分支，以及两个词典中为无人显示的画面准备的三条文案键。

**在注册时要求完成双重验证注册。**在 Aeven 中保护是可选的，因此不想要它的读者必须先取得身份验证器应用才能进入产品。

## 后果

- 注册在名字处结束，新读者无需做出安全决策即可进入产品，该步骤的 API 调用也从两次变成一次。
- 不提供任何 `/mfa` 路由的部署无需状态回答即可完成注册；该步骤唯一的拒绝就是名字被拒绝。
- 注册只能从账户设置进入；`MfaForm` 渲染单一主体，`infoKey` 在 `mfa.scan` 与 `mfa.disableInfo` 之间切换。
- 被移除的三条文案键离开两个包的英文、中文与西班牙文表，因此每个词典相对其键类型仍然完整。
- `packages/client/ui-auth-aeven/tests/name-check.client.spec.tsx` 在名字保存后直接等待 `onNamed`，不经过中间画面，保留名字被拒绝与登录结束的用例；提供表单的 snapshot 随该提供一并删除。
