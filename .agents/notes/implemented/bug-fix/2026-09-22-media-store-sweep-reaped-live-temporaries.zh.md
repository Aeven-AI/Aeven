# Agent Note: media-store 的清扫回收了仍被活跃写入占用的临时文件

Status: implemented

[English](2026-09-22-media-store-sweep-reaped-live-temporaries.md) | 中文

## Problem

`packages/experimental/subscription-auth/tests/media-store.spec.ts` 的 `never publishes two artifacts under one id when two stores share a root` 在一次完整覆盖率运行中失败，报出 `expected Error: ENOENT … to match object { code: 'INVALID_ID' }`。它单独运行时通过，只在整套测试的争用下失败。

该断言的含义是：失败的那次 `save()` 必须因为无法分配未被占用的 artifact id 而被拒绝。`ENOENT` 说明发生的是另一回事，而复现给出了确切的名字：`link '…/objects/89/.tmp-849d1129bc23bbaa' -> '…/objects/89/89221da…'`。

`writeExclusiveFile` 通过 `.tmp-<random>` 文件发布：写入载荷、把该名字 link 到最终名字，然后 unlink 临时文件。因此在整个序列期间，该临时名字都属于一次进行中的写入。而 `listRegularFiles` 会 unlink 它遇到的**任何** `.tmp-` 条目，且该存储的锁是按实例持有的，因此在同一个根上打开的第二个 `MediaStore` 并不会与第一个互斥。它的清扫回收了仍被活跃写入占用的临时文件，那次写入的 `link()` 随即以 `ENOENT` 失败——一次本在正常推进的保存被报告为文件缺失。

该测试的两个存储共用一个根，而这正是该验收用例存在的目的，因此缺陷在产品的清扫逻辑，而不在测试。

## Decision

只有当临时文件的年龄超过 `MEDIA_STORE_TEMP_GRACE_MS` 时，清扫才回收它。没有任何单次发布序列能跨越该宽限期，因此超过它的临时文件不可能再属于活跃写入；而新鲜的临时文件则留给它的所有者去完成并移除。

年龄以墙钟时间度量，而非存储注入的 `now()`。清扫真正要问的是"某个进程在多久以前写下了这个文件"，注入的测试时钟并不描述这件事；若读取注入时钟，一个把时间向前拨动的用例就会回收另一进程刚刚创建的临时文件。

`reclaims stale temporaries and strays while keeping live leaves` 现在在清扫前把临时文件回拨到宽限期之外，而这正是它的名称早已声明的含义，也一直是该清扫的约定。`keeps the leftovers a locked-down store directory refuses to release` 同样回拨其临时文件，使清扫仍能到达其注入故障所拒绝的那次 unlink。新增用例 `leaves a fresh temporary alone so a concurrent write can still publish it` 直接固定该保护，并在缺少本次修改时失败。

## Alternatives considered

**对根目录加跨存储锁。** 该存储的锁按构造就是按实例持有的，而共享根锁会为一个只涉及临时名字的风险把彼此独立的写入方串行化。它同样帮不到从未取锁的第二个进程，而那正是该验收用例所描述的情形。

**在临时名字中写入所属进程 id，只回收外来者。** pid 会被复用，于是崩溃写入方留下的临时文件将一直不朽，直至其 pid 再次出现。年龄回答的是真正的问题——是否还有活跃序列可能占用这个名字——且不依赖进程标识。

**让发布容忍 `link()` 的 `ENOENT` 并重试。** 那是用重试掩盖被回收的临时文件，而非阻止它，而与同一次清扫赛跑的重试仍可能再次失败。它也仍然放任清扫破坏另一写入方的成果，而那正是缺陷本身。

**放宽测试以接受 `ENOENT`。** 该测试断言的正是此存储存在的意义：两次竞争的保存中恰有一次发布，失败的一次以明确的理由失败。接受 `ENOENT` 等于把缺陷记录为规格。

## Consequences

十二路争用下的直接竞态复现：修改前 720 次中失败 1 次，修改后 2160 次中失败 0 次。该测试文件在三轮十二路争用中 36 次运行全部通过，且 `media-store.ts` 在语句、分支、函数与行四项上保持按文件 100%。

真正被遗弃的临时文件现在会比以往多存活至多 `MEDIA_STORE_TEMP_GRACE_MS`。它占用的字节不计入总量上限，因为 `storedObjectBytes` 只累计以摘要命名的对象叶子，所以这段延迟消耗的是磁盘，而非新产物的准入额度，且宽限期之后的下一次清扫即会移除它。
