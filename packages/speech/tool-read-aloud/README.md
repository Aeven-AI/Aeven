<!-- Parent: packages/speech/README.md -->

# @aeven/tool-read-aloud

Model Experience: registers one tool, `read_aloud`, that turns spoken reading of the agent's replies
on or off for the current Session. Its result is one short confirmation line; nothing is spoken by
the Host.

- Tool name: `read_aloud`
- Input: `{ enabled: boolean }`
- Output: `{ enabled: boolean }`

## Summary

The tool exists so an agent can start reading its replies aloud by itself — the case that motivates
it is language practice, where the learner should hear every answer without clicking the composer's
speaker each turn. The call carries the switch, so it is replayable: nothing is held in Host memory.

The Web Surface watches settled `read_aloud` calls and moves its own read-aloud toggle to match. The
tool therefore talks to the reader through the session log alone; a Surface that does not implement
reading simply shows the tool card.

## Use this package

Load it in the Host composition beside the other model-facing tools:

```yaml
- id: tool-read-aloud
  name: '@aeven/tool-read-aloud'
```

## Understand the implementation

`execute` returns the requested switch without touching any service; the confirmation text is
produced by the tool's `render`. The client half lives in `@aeven/client-ui-tts`, which scans the
conversation's settled tool calls for `read_aloud` and applies the newest one to its own engine.

## Known Limitations and Deferred Work

- The switch is per Session and lasts as long as that reader's page state; there is no durable
  cross-device preference.
- Only the Web Surface reacts. A terminal client sees the tool result but reads nothing aloud.
