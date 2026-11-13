---
description: "Saved Recorder recordings per account: transcripts mirrored through account sync, audio files shared through file sync."
kind: "package-reference"
---

# @aeven/recordings

English | [中文](README.zh.md)

## Summary

`ctx.recordings` keeps the Recorder's finished recordings for each account. An account's transcripts live in one JSON file under `dataRoot`, mirrored into the account's synced `recordings` document so they appear on all of its devices; the entry changed last wins, and a deletion leaves a tombstone that removes the recording and its audio everywhere. Audio is one file per recording in the account's audio folder, which file sync shares with the account's other devices when it runs. An account this Host does not sync, such as one with no signed-in user, keeps its recordings locally.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it with an absolute `dataRoot`; `maxAudioBytes` bounds one recording's audio. Every method takes the account as `owner` (`LOCAL_OWNER` without a signed-in user): `list` returns summaries newest first, `get` one recording, `save` stores a recording that holds transcribed speech, `rename` and `remove` change one, and `appendAudio`, `finishAudio`, and `readAudio` move its audio in chunks. `recordingId` refuses any id that is not a UUID before it names a file. The service opens the account's synced document on `sync/status`, merges it with the local entries, and shares the audio folder through `ctx.fileSync` when that service is composed.

-----

<a id="further-exploration"></a>
## Further Exploration

- [api-speech-to-text](../api-speech-to-text/README.md) — the `speech` Remote methods that expose this store to the browser.
- [ui-sidebar-meeting](../../client/ui-sidebar-meeting/README.md) — the Recorder, which saves into it and lists it.
- [sync](../../sync/sync/README.md) and [file-sync](../../sync/file-sync/README.md) — the account sync and file sync this store rides on.

-----

<a id="model-experience"></a>
## Model Experience

None, as saved transcripts and audio stay in the account's own store; a transcript reaches a request only when the user adds it to the chat.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No invariant companion** — No invariant companion is published because each account's entries have one owner, this service, which writes the local file and the synced document from the same commit, so no independent observation can diverge from them.
- **Audio follows file sync** — a Host without file sync, such as the hosted app, receives transcripts but not audio; the Recorder is composed only in the desktop app for that reason.
- **Renaming has no surface** — `rename` exists, but the Recorder's modal does not offer it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
