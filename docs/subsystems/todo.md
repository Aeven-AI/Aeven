# Todo

English | [中文](todo.zh.md)

The durable todo vocabulary owned by [`@aeven/tool-todo`](../../packages/todo/tool-todo/README.md). The model-facing tool replaces one agent session's whole list; the package also owns the event declaration, the two replay projections over it, the model's read-back of that plan, and the invariant companion. Tool behavior and configuration are on the [package README](../../packages/todo/tool-todo/README.md).

Source: [`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem` — one list entry

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

## Durable event and invariant

The package declaration-merges `todo/write: { todos: TodoItem[] }` into `SessionEventMap`. The event is log-only and carries the complete replacement list; the generated [persistence catalog](../persistence-catalog.md#todowrite--log-only) records its declaration site. The package's invariant companion validates existing and newly announced sessions in one pass, then tracks committed turn boundaries incrementally so every live `todo/write` is checked before append without rescanning the log.

## Two projection lifetimes

Both units fold the same input and diverge only on the turn boundary. `todos` is the client-wired standing plan the dock renders: the latest whole list, cleared by the next `turn/start` so a finished checklist never reads as the current turn's work, and `null` before the first write. `todoPlan` is host-only — declared without `wire`, so it never reaches a client — and retains the session's latest `todo/write` across turn boundaries, because the agent's own working memory has to survive a turn the way its transcript does. The package contributes that retained value to every step as runtime context, so the model reads its plan back instead of reconstructing it from the `todo_write` arguments left in its history, which compaction replaces with a lossy summary.

A third host-only unit, `todoStale`, counts committed steps since the last write and folds the step count at the last notice this package injected. The package reads it to nudge a plan that has gone stale, so a model that stops updating its list is told so rather than drifting silently.
