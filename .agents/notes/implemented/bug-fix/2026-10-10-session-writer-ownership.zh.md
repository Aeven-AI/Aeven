# Agent Note: 跨 Host 的逐会话写入所有权

Status: implemented

[English](2026-10-10-session-writer-ownership.md) | 中文

## Problem

Web 与 Electron Host 可以共享账号和持久化根目录，同时分别持有同一 Session 的独立副本。进程内的序列计数器和 preparation reservation 无法阻止第二个 Host 将第一个 Host 的未结束轮次视为中断，追加恢复事件并恢复执行同一日志。两个执行随后会追加重叠的序列号。

## Decision

JSONL 后端通过 `PersistenceBackend.acquireWriter` 为每个 Session 身份获取操作系统管理的写入锁。协调器在提交恢复、创建、删除、接管 live Session 或追加之前获取锁，并在 preparation 和发布期间保留所有权，直到该 live Session 的最终 flush 完成。未发布的回滚和仅 load 的恢复会释放所有权；后端销毁先排空写入，再释放剩余锁。POSIX 使用非阻塞 `flock`；Windows 持有禁止共享的文件句柄。持久锁文件永不 unlink，进程退出会释放内核锁。

读取不依赖写入所有权。不同 Session 身份可在不同 Host 中并发执行，包括以同一用户登录的 Host。冲突的 resume 返回 `session/agent-busy`。Electron 流帧保留 Host 错误，而不是以不明确的网络错误终止字节流。

## Alternatives considered

**整个 home 只有一个写入者。** 这会阻止独立聊天在不同 Host 中执行，限制范围超过 Session 执行所有权。

**追加前只检查日志修订。** 两个 Host 都可能在任何一方写入前通过检查，而且恢复仍可结束另一个 Host 正在执行的轮次。所有权必须覆盖恢复和执行，而不仅是一个批次。

**读取时丢弃冲突记录。** 重叠序列可能代表真实且分叉的用户消息和工具结果。读取器继续拒绝已提交的损坏日志；恢复分别保留每个后续分支。

## Consequences

锁在遵循规则的 JSONL Host 之间协调写入，不改变 Session 日志格式或账号所有权。Live Session 保留所有权直到销毁；本次改动不实现向该执行进行跨 Host 投递。运行旧代码的 Host 必须重启才能参与。TypeScript 与构建验证不能证明并发运行时行为或 Windows 锁行为；按用户的验证范围，这些检查没有执行。
