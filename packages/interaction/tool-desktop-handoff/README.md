---
description: "The model-facing offer_desktop tool: how Aeven Web mounts it, what it opens in the reader's window, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-desktop-handoff

English | [中文](README.zh.md)

## Summary

`@aeven/tool-desktop-handoff` lets the model offer the Aeven desktop app when a request needs the reader's own computer and the Host cannot reach it, as on Aeven Web. It registers one tool, `offer_desktop`, whose call becomes a `desktop-handoff/offer` waterfall that the client showing the session answers by opening the "Available in Aeven Desktop" dialog of `@aeven/client-ui-desktop-handoff`. The dialog continues the same conversation in the desktop app or offers the download. The tool reads and changes nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `aeven` preset declares the row disabled, and the `avn-hosted-app` bundle enables it: a desktop Host reaches the reader's computer itself, so the offer would only be noise there.

### Configuration

The field is optional; an invalid value fails plugin load.

| Field | Default | Effect |
| --- | --- | --- |
| `answerTimeoutMs` | `10000` | Milliseconds a window showing the session has to open the dialog, declared as the tool's `timeoutMs`; past it the offer counts as unanswered. |

```yaml
- id: tool-desktop-handoff
  name: '@aeven/tool-desktop-handoff'
```

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool dispatches `desktop-handoff/offer` scoped to the calling agent, carrying the model's `reason` (`computer`, `files`, `terminal`, `device`, or `models`) and a signal bounded by `answerTimeoutMs`. `@aeven/api-remotes` forwards it to the window showing that session, which opens the dialog with the explanation for that reason and answers `shown`; a window showing another session calls `next()`, and the final fallback answers `no-window`. Because the offer travels as a live event, a conversation loaded later from its history never reopens the dialog.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`offer_desktop` schema](../../../docs/tool-catalog.md#aeventool-desktop-handoff).

##### Shown result

```markdown
A dialog in the user's window now offers to continue this conversation in Aeven Desktop, or to download it. Tell the user in one sentence what the desktop app would do for this request.
```

##### No-window result

```markdown
No window is showing this conversation, so nothing opened. Tell the user that the Aeven desktop app can do this on their computer.
```

#### Token effect

The schema is fixed per request while the tool is visible; a call adds one short result.

#### KV Cache effect

Prefix-stable while the visible tool set is unchanged; a result is appended.

## Known Limitations and Deferred Work

- **No desktop routing in the dialog** — when one of the reader's desktops is online, a conversation on Aeven Web already runs there; the offer appears only for a turn that runs in Aeven Cloud, and the dialog does not yet list the online desktops.
- **The model decides when to offer** — the Host does not detect a request that needs the reader's computer; the tool description asks the model to call it where it would otherwise say the request cannot be done.
- **No invariant companion** — No runtime invariant companion is published because the tool holds no state of its own: one call dispatches the scoped `desktop-handoff/offer` waterfall, and `renderDesktopHandoffResult` is a pure function of the single answer a client plugin produced, so there is no second observation to compare.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
