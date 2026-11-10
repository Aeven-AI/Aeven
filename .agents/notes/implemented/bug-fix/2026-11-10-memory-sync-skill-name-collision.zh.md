# Agent Note：记忆同步让两台设备上同名的技能归并为一个

Status: implemented

[English](2026-11-10-memory-sync-skill-name-collision.md) | 中文

## 问题

MemOS 以 `id` 作为技能的键，同时每个所有者的每个名称只允许一个技能（`uq_skills_owner_name`，作用于 `owner_agent_kind`、`owner_profile_id`、`name`）。同一账户的两台设备可能各自以不同的 id 结晶出同名技能。记忆同步（`packages/memory/memory-memos/src/sync.ts`）按键 upsert 行，因此应用另一台设备的技能时失败，报 `UNIQUE constraint failed: skills.owner_agent_kind, skills.owner_profile_id, skills.name`。一个分片文档在一个事务中应用，所以该失败还会回滚同一分片中的所有其他技能，并在每次应用时重复。托管 Aeven 在 2026-11-07 到 2026-11-10 之间记录了 236 次。

## 决策

复制的表可以声明键之外的唯一索引（`TableSpec.unique`）；`skills` 声明其所有者加名称的索引。写入传入行之前，镜像会查找唯一值相同但键不同的本地行。编码后的键排序在前的行保留：输入行落败时被跳过，本地行落败时在应用标记下删除，因此该删除不会发布。每台设备对同一对键做同样的比较，因此都保留同一个技能。

## 考虑过的替代方案

只跳过失败的行而不删除本地行，能让分片的其余部分得以应用，但每台设备会永远保留自己版本的技能。

把落败行的删除作为墓碑发布，也会把它从分片文档中移除，但墓碑会胜过该键之后的任何编辑，而创建落败技能的设备已经按同一规则丢弃它。

合并两个技能的字段被否决：它们是独立的结晶，MemOS 对技能的流程或统计没有合并规则。

## 影响

两个同名技能之一会从创建它的设备上消失，该设备上关于它的试验也随之失去关联。试验本身保留，因为同步连接关闭了外键。技能的统计从保留的副本重新开始。

落败的行留在分片文档中，每台设备每次应用时都会跳过它。

## 验证

在 MemOS 真实结构上、使用 `packages/memory/memory-memos/tests/sync.spec.ts` 的测试工具做了一次临时双设备运行：设备 A 持有 `release`（`sk_a0000001`）和 `other-from-A`，设备 B 持有 `release`（`sk_a0000009`）。有了修复，两台设备最终都持有 A 的 `release` 和 `other-from-A`，两个镜像都没有警告。没有修复时，B 从未收到 A 的任何一个技能。现有的记忆同步测试通过。
