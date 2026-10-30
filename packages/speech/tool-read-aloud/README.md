---
description: "Model-facing switch that moves the Web reader, without speaking anything itself."
kind: "package-reference"
---

# @aeven/tool-read-aloud

## Summary

The tool exists so an agent can start reading its replies aloud by itself — the case that motivates
it is language practice, where the learner should hear every answer without clicking the composer's
speaker each turn. The call carries the switch, so it is replayable: nothing is held in Host memory.

The Web Surface watches settled `read_aloud` calls and moves its own read-aloud toggle to match. The
tool therefore talks to the reader through the session log alone; a Surface that does not implement
reading simply shows the tool card.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load it in the Host composition beside the other model-facing tools:

```yaml
- id: tool-read-aloud
  name: '@aeven/tool-read-aloud'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`execute` returns the requested switch without touching any service; the confirmation text is
produced by the tool's `render`. The client half lives in `@aeven/client-ui-tts`, which applies the
newest settled `read_aloud` call to its own engine.

-----

<a id="model-experience"></a>
## Model Experience

Registers one tool, `read_aloud`, and nothing else. Its description and its parameters reach every
request; a call adds one `tool/call` and one `tool/result` to the log.

- Tool name: `read_aloud`
- Input: `{ enabled: boolean }`
- Output: `{ enabled: boolean }`

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The switch is per Session and lasts as long as that reader's page state; there is no durable
  cross-device preference.
- Only the Web Surface reacts. A terminal client sees the tool result but reads nothing aloud.

-----

<a id="dev-note"></a>
## Dev Note

The tool is the model's only route into the reader and speaks nothing itself: `execute` echoes the
switch, `render` writes one confirmation line, and the Web Surface moves its own toggle from the
settled call. Keeping synthesis out of the Host means a headless run needs no audio device and
replay produces no side effect.

The card title states the direction — `Read replies aloud` or `Stop reading aloud` — because the
result line alone does not say which way the switch went for a reader skimming the transcript.

No runtime invariant companion is published: the call carries its own value, so the tool holds no
state that an independent observation could diverge from.
