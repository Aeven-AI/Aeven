# Agent Note: Durable attachment paths in Markdown images

Status: implemented

English | [中文](2026-09-26-durable-attachment-paths-in-markdown.zh.md)

## Problem

Image attachments live under durable, extensionless digest paths. The Web Markdown renderer accepts absolute paths and loads them through `/api/file`, but that route selected the response media type from the extension alone. Its `nosniff` header left an attachment object as `application/octet-stream`. An agent displaying a device screenshot copied the object to `/tmp` with a `.webp` suffix and embedded that temporary path in a durable reply. The image broke when the copy disappeared.

## Decision

`/api/file` identifies PNG, JPEG, WebP, and GIF signatures when the resolved file has no extension. It keeps the composed filesystem provider's path authorization and byte limit, and keeps extension-bearing files' declared media type. `device_screenshot` includes the attachment provider's durable host path in its text result when the provider supplies one, with guidance to embed that path directly. The attachment reference and object storage layout stay unchanged. The [model-readable image paths note](../feature/2026-08-21-model-readable-image-paths.md) still owns path disclosure to models; the [extensionless read_image note](2026-08-28-read-image-extensionless-paths.md) owns image admission through that tool.

## Alternatives considered

**Copy into a named temporary file.** A suffix gives the file route a media type, but the copied file has no lifetime tied to the session log. A persisted reply must refer to persistent bytes.

**Rename attachment objects with extensions.** This changes the content-addressed storage layout and every existing object path to solve a display problem in one route.

## Consequences

A reply can embed the durable object path without making a second file. The file route reads an extensionless file to determine its response type, including on `HEAD`; unrecognized bytes remain `application/octet-stream`. Existing replies that name a deleted temporary copy remain broken because the session log records that path, not the attachment id.
