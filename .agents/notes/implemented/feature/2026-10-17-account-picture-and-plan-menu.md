# Agent Note: Account picture upload and the plan in the account menu

Status: implemented

English | [中文](2026-10-17-account-picture-and-plan-menu.zh.md)

## Problem

An Aeven account could show a picture but never change it. `profile.avatar` was written only when a provider sign-in carried one, so Account settings drew whatever the account arrived with: there was no upload, and no way to go back to the initial. The account menu named the reader and offered Settings and sign out, but not the plan they were on, and neither the picture nor the name led anywhere — a reader who wanted to change either went to Settings and found the page by name.

## Decision

The identity row at the top of Account settings carries a photo control and, once the account has a picture, a delete control; the picture itself opens the picker too, because that is what a reader who wants a different picture clicks. Both go through the published reader: `setImage` posts the file to `/upload-avatar` as multipart with the reader's bearer, `removeImage` posts to `/delete-avatar`, and each adopts the answer through `session.adoptImage` and republishes the reader. The row also keeps the returned URL in its own state, so the page redraws at once instead of waiting for the reader to be read again.

The node API owns the picture. `ImageService.saveAvatar` re-encodes the upload with sharp into a square WebP — `config.file.avatarSize` (512) and `avatarQuality` (82) — writes it under the picture directory the static handler serves, and answers the fields the profile records: `url`, `contentType`, `width`, `height`, `updatedAt`. `UserService.setAvatar` authenticates the bearer and checks the upload before decoding it (PNG, JPEG, or WebP, at most `config.file.avatarMaxSize`; another type is `415 invalid-image-type`, bytes no decoder accepts are `400 invalid-image`), records the new avatar, and deletes the picture it replaced. `deleteAvatar` unsets `profile.avatar` and deletes that file. The route answers an oversized upload as `413 image-too-large` rather than letting multer's error reach Express's HTML page, and `/upload-avatar` is the only route with that limit — the chat upload keeps the 50 MiB ceiling.

`ImageService.removeAvatar` unlinks only a path this service writes. A stored value that is a provider's remote URL, a path that climbs out of the picture directory, or the directory entries `.` and `..` is ignored, so the value a profile carries can never turn a delete into an unlink elsewhere on disk.

The account menu names the plan under the reader's name. It reads `/api/cloud/subscription` through the same cache the Account page uses, so a plan change made on either face cannot leave the other showing the old answer, and a refused or unreachable read draws no plan line rather than an error the menu cannot act on. The picture and the name form the menu's first row, which emits `settings/open` with `account`; the Settings row below it still opens the settings landing page.

## Alternatives considered

**Keep the picture in the page rather than on the account.** Rejected: a picture is an account fact. A reader who uploads one on this machine expects the account menu, the next load, and their other clients to draw it, and a page-local image would also have to be re-encoded or bounded somewhere the client cannot own.

**Store the uploaded bytes as supplied.** Rejected: it fixes nothing about the size, the format, or the metadata an original carries. A phone picture is several megabytes, may be HEIC or a 12-bit JPEG, and may carry location data; re-encoding bounds all three at once, which is why the picture that is served is never the file the reader handed over.

**Let the menu read the plan through its own route call.** Rejected: two readers of one fact disagree after a change. The menu and the Account page share one read cache, and any write the page makes drops it.

**Fetch the account type on mount rather than on first open.** Rejected: the avatar sits in the resident band for the whole page life and most readers never open the menu. Reading on first open keeps a signed-in page's requests unchanged for everyone who does not.

**Keep the profile row inert and only add the plan line.** Rejected: the picture and the name are the reader, so they are the natural way into the page about them; sending readers to the settings landing page and asking them to pick Account again makes the shortest path the longest one.

## Consequences

A reader can set and clear their own picture from Account settings, and the account menu states the plan and leads to the account page from the picture and the name. The stored picture is a square WebP: a non-square upload is cropped rather than letterboxed, and an animated one keeps its first frame.

The reader is stated on the page, not subscribed to. The identity row updates from its own state, and the resident avatar shows a new picture the next time it renders — opening the menu or leaving settings does — rather than in the same tick as the upload. Making the corner subscribe would mean declaring a store or hook share on the `shell.corner` slot, which belongs to `ui-layout` and would invert the layering for one avatar.

A replaced picture is deleted after the new one is recorded, so a failure in that cleanup leaves an unreferenced file rather than a broken profile; a picture is never removed before its replacement is stored.

## Testing

`tests/unit/services/ImageService.test.js` drives the real sharp pipeline against real PNG and JPEG fixtures in a temporary directory: the stored file is a WebP at the configured size whatever the source format or aspect ratio, undecodable bytes reject, and `removeAvatar` deletes its own file while ignoring a provider URL, a traversal, `.`/`..`, and a picture that is already gone. `tests/unit/services/UserService/avatar.test.js` pins the account side: the profile records the stored fields, the replaced picture is deleted, a missing user, a missing file, an empty upload, an unaccepted type, undecodable bytes and a database failure each answer their own refusal. On the client, `tests/account-picture.client.spec.tsx` covers the row's upload, dismissal, removal, both failure messages and the busy labels, and `tests/api.client.spec.ts` pins the multipart shape, the bearer, and what each answer adopts into the page session.
