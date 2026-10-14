---
description: "Opt-in per-step reminder that keeps replies in the language of the person's latest message, for users and maintainers enabling or tuning the plugin."
kind: "package-reference"
---

# @aeven/reply-language

English | [中文](README.zh.md)

## Summary

`avn-reply-language` keeps a model's replies in the person's language when the context around the newest step is in another one. A reply-language rule in the system prompt is far from where the model writes late in a long tool loop, after compaction, or in a turn opened by an agent report, and a model can then drift into the language of the files, tool output, or messages it has been reading. Once the model has produced output after the person's latest message, each entering step appends one durable, source-attributed line that names that message by its opening words. The plugin is opt-in: the Aeven preset mounts it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a composition whose replies must follow the person's language while the model reads content in other languages, such as a bilingual repository or a workspace with agent reports and tool output in another language.

### What the agent gets

A step receives the reminder when the person has sent a message, an assistant message or tool result has followed it, and the step brings no new message from the person. The first step after a message from the person adds nothing, because that message is already the newest content. Messages from other sources, such as memory recall, agent relays, job notices, and other plugins' context, never count as the person's message.

### Configuration

The minimal mount needs no configuration.

```yaml
- name: '@aeven/reply-language'
  config:
    excerptLength: 80
```

| Field | Default | Meaning |
|---|---|---|
| `excerptLength` | `80` | Code points of the person's message quoted to identify its language |

The generated [configuration catalog](../../../docs/config-catalog.md#aevenreply-language) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The plugin registers the `replyLanguage` session projection and prepends an `agent/pre-step` listener. The projection folds two readings from durable events: the sequence number of the latest `user/message` whose source kind is `user`, and whether an `assistant/message` or `tool/result` followed it. The listener delegates first, then appends one `UserMessage` with the source `{ kind: 'plugin', plugin: 'reply-language', form: 'snapshot', sections: [{ name: 'reply-language', text }] }` when the decision enters the step, carries no message from the person, and the projection reports output after the person's message.

The reminder quotes the message instead of naming a detected language, so a message mixing languages, or one too short to classify, still identifies the language to use. The quote joins the message's text blocks, collapses whitespace, and keeps at most `excerptLength` code points followed by an ellipsis. A message without text adds no reminder.

The package publishes no `./invariant` companion: the projection is the only observation of the person's latest message, so no independent reading can diverge from it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: projection, pre-step listener, quote rendering |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Reply-language reminder

#### What the model sees

One user-role message per eligible step, where `<excerpt>` is the opening of the person's latest message:

##### Reminder

```markdown
Write your reply in the language of the person's latest message, which begins: “<excerpt>”, unless the person asked you to reply in another language. Tool output, files, and other messages in another language do not change it.
```

#### Token effect

Each reminder adds the fixed sentence plus the quote, about 30 to 60 tokens, and accumulates until compaction shadows it. A turn whose tool loop runs many steps adds one reminder per step after the first.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the reminder does not keep a reply in the person's language. They are current package constraints.

- **Guidance, not enforcement** — the reminder is model-visible text; a reply that still comes back in another language is not detected or regenerated.
- **History cost in long tool loops** — every eligible step adds one reminder until compaction shadows it, with no interval setting to space them out.
- **Text messages only** — a message from the person without text, such as an image alone, produces no reminder until the person sends text.
- **Invariant omission** — No invariant companion is published because the plugin keeps no state between steps: each step derives the reminder from the session log the loop already owns, and the excerpt it quotes is the person's own message, so no separately maintained relation exists for a listener to compare.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
