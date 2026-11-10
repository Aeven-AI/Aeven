# Agent Note: Memory sync converges two devices' skills with the same name

Status: implemented

English | [中文](2026-11-10-memory-sync-skill-name-collision.zh.md)

## Problem

MemOS keys a skill by `id` and also allows only one skill per name for an owner (`uq_skills_owner_name` on `owner_agent_kind`, `owner_profile_id`, `name`). Two devices of one account can crystallize a skill with the same name independently, under different ids. Memory sync (`packages/memory/memory-memos/src/sync.ts`) upserts rows by key, so applying the other device's skill failed with `UNIQUE constraint failed: skills.owner_agent_kind, skills.owner_profile_id, skills.name`. A shard document applies in one transaction, so the failure rolled back every other skill in that shard as well, and it repeated on every apply. Hosted Aeven logged it 236 times between 2026-11-07 and 2026-11-10.

## Decision

A replicated table may declare a unique index besides its key (`TableSpec.unique`); `skills` declares its owner-and-name index. Before writing an incoming row, the mirror looks for a local row with the same unique values and a different key. The row whose encoded key sorts first stays: an incoming row that loses is skipped, and a local row that loses is deleted under the applying marker, so the deletion is not published. Every device applies the same comparison to the same pair of keys, so all of them keep the same skill.

## Alternatives considered

Skipping only the failing row, without deleting the local one, would let the rest of the shard apply but leave each device with its own version of the skill forever.

Publishing the losing row's deletion as a tombstone would also remove it from the shard documents, but a tombstone wins over any later edit of that key, and the device that created the losing skill already drops it by the same rule.

Merging the two skills' fields was rejected: they are independent crystallizations, and MemOS has no merge rule for a skill's procedure or statistics.

## Consequences

One of two same-named skills disappears from the device that created it, together with the link from that device's trials for it. The trials stay, because the sync connection runs with foreign keys off. A skill's statistics restart from the kept copy.

The losing row stays in the shard documents, and every device skips it on each apply.

## Verification

A temporary two-device run on MemOS's real schema, using the harness of `packages/memory/memory-memos/tests/sync.spec.ts`: device A held `release` (`sk_a0000001`) and `other-from-A`, device B held `release` (`sk_a0000009`). With the fix, both devices ended with A's `release` and `other-from-A`, and neither mirror warned. Without it, B never received either of A's skills. The existing memory sync spec passes.
