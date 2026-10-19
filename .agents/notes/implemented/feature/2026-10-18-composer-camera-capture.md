# Agent Note: The composer's attach menu captures from the camera

Status: implemented

English | [中文](2026-10-18-composer-camera-capture.zh.md)

## Problem

The attach menu offered File, Goal, Plan, and Feedback but nothing that used the device in front of the reader. A screenshot, a whiteboard, or an object on the desk had to leave the app, become a file, and come back through the picker.

The client has no video input either: a prompt part is an image or a file whose text `document-extract` produced, and the model reads images. A recorded clip therefore has no route into a turn as a clip.

## Decision

The menu's Camera row opens one popup in the composer's input domain, drawn by the `Modal` primitive so its mask, radius, elevation, and close control are the ones every other dialog in the client wears. The body is a rounded 4:3 stage holding the live preview — mirrored for the user-facing camera, the way a phone shows it — with one black capsule floating over it whose two lucide glyphs select a still or a clip, the active mode drawn as a white disc. Under the stage sit the countdown disc, the shutter, and the flip disc; a pill in the corner reads the recording clock and the frame count. Every glyph comes from `ui-primitives` (the `timer` and `video` lucide paths are transcribed there), and every sentence is a locale key.

The still mode encodes the current frame as one JPEG and hands it to `InputActions.addImageFiles`, which is the composer's own intake: the picker, the drop, and the camera share one path, so image limits, their toasts, and the busy-phase refusal stay in one place. Its shutter counts three seconds by default — the countdown disc turns that off, a second press ends a running count, and the number the reader sees is what is left — because a still is often taken of people who need a moment. The clip mode records the stream itself with `MediaRecorder` — WebM/VP9 with Opus when the browser offers them, stopping by itself at thirty seconds — replays the file in the frame, and passes it to the file intake on `Use`. Either capture waits for `Use`: the popup never closes on the shutter, and `Retake` drops the capture without leaving.

The stream asks for the microphone with the camera and falls back to a silent stream when the microphone is refused, so a denied microphone costs the sound and not the camera. `@aeven/document-extract-video` claims the recorded formats on the Host, which is what lets the composer's file intake accept the clip at all: it probes with the host's `ffprobe` and stores one sentence of facts with the file.

`capture.ts` owns the DOM-only parts: `openCamera` maps a refused `getUserMedia` onto `permission` or `unavailable` (a denial reads differently from a device that is not there), `grabFrame` encodes one frame at the stream's own size, and `elapsedLabel` formats the recording clock. `CameraDialog` owns the stream lifecycle: one stream per open, facing, and retry, stopped in the effect's cleanup, so the camera light never outlives the popup, and so flipping to the other camera releases the first.

A clip arrives as frames because nothing downstream reads a video: attachments are images or extracted document text. Sending the frames is what makes a recording visible to the model, and the review step shows exactly the payload that will be sent rather than a clip that would be dropped.

## Consequences

The camera is a composer feature, not a target: it is the same popup in the Hero and the docked composer, and it is unavailable where `addImages` is absent, because the row and the intake share that condition. A clip records sound and stops at thirty seconds. The model receives the clip's facts — duration, frame size, codec, container, size — and never its frames or audio, so a question about what a clip shows is answered from the description alone.

## Verification

`camera-capture.client.spec.ts` pins both refusal kinds, the encoder's failure arms, and the clock. `camera-dialog.client.spec.tsx` drives the popup with a stubbed camera, canvas, and object-URL table: the front camera opens, a flip releases the first stream, a denied permission offers a retry, a still reaches `onCapture` as one JPEG, a clip's samples accumulate per interval, a full clip stops itself, a refused frame is dropped without ending the recording, and `Cancel` never captures. The attach-menu case in `input-bar.client.spec.tsx` pins the five rows in order and that the Camera row opens the popup.

## Alternatives considered

**MediaRecorder plus a playable clip.** It would review the real clip, but no path carries one: the file intake accepts only `document-extract` formats, and the wire has no video part. Reviewing the sampled frames shows the payload the model receives.

**A separate client package.** The popup is composer UI that reads the composer's own intake and holds no independent state others share, so it belongs to `ui-conversation`'s input domain rather than to a plugin that would need a slot and a store to reach the same actions.
