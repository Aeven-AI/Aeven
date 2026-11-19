# Agent Note: 指针 Send 遵循繁忙态 Enter 偏好

Status: implemented

[English](2026-11-19-pointer-send-follows-busy-enter.md) | 中文

## 问题

Turn 运行期间，普通 composer 的主按钮在草稿有内容时变为 Send（[运行中草稿取得主 Send 操作](2026-08-20-running-draft-primary-send.zh.md)）。该按钮始终走 Queue 路径，而普通 Enter 使用 `ui-conversation.busyEnter` 偏好，默认值为 Steer。每条排队消息都要等待自己的 Turn，因此在长 Turn 期间用按钮连续发送多条后续消息的用户，会收到针对几分钟前所发消息的回复。2026-11-19 的 Session `08b945fd…` 显示了这一情况：九次按钮发送依次排队，"THEN SHARE!!!" 的回复在发送 40 秒后、排在三条更早的消息之后才开始，尽管该账户的偏好是 Steer。

## 决策

`InputBar` 通过与普通 Enter 相同的 `resolveSubmitMode(running, 'enter', subagent === null)` 调用提交 Send 按钮，因此按钮按 `busyEnter` 以 Queue 或 Steer 投递，Cmd/Ctrl 组合键保留另一种模式。不支持 steering 的会话（subagent 续接）仍然排队，因为 steering 不可用时 `resolveSubmitMode` 返回 Queue。这取代了先前"指针 Send 从不继承键盘偏好"的规则；先前 Agent Note 中 Stop/Send 位置切换保持不变。

## 验证

`input-bar.client.spec.tsx` 覆盖 Steer 偏好下用按钮发送运行中草稿（以 Steer 投递），以及 Queue 偏好下仅含附件的草稿（以 Queue 投递）。`apps/web/tests/live-interactions.e2e.ts` 中在挂起流期间排队后续消息的免密钥 Web 场景，会在其 harness home 中写入 `busyEnter: queue`，使点击仍进入队列面板。

## 考虑过的替代方案

**指针 Send 保持 Queue。** 正是这一行为造成了上述积压；用户的 Steer 偏好对其实际使用的控件不起作用。

**显示独立的 Queue 与 Steer 按钮。** 这会为用户已在设置中做出的选择占用 composer 空间，而组合键已经为键盘用户提供另一种模式。

## 影响

在默认 Steer 偏好下，用按钮发送的后续消息会在下一个 step 加入运行中的 Turn，而不是等待自己的 Turn。偏好 Queue 的用户设置 `busyEnter: queue` 后，按钮和 Enter 都会排队。
