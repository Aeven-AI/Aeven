---
name: google-forms
description: Create, read, and edit Google Forms surveys, quizzes, and registration forms, and inspect submitted responses through the connected Google Drive account.
---

# Google Forms

Use the Google Drive connector's discovered `mcp__google-drive_<id>__` tools. Google Forms API must be enabled in the OAuth application's Google Cloud project. The existing Drive authorization covers form edits and response reads; a separate connection is unnecessary.

## Tools

- Read a form with `forms_get` and `{formId}`. Read submitted responses with `forms_responses` and `{formId}`.
- For native operations, call `workspace_schema` with `{method: "forms.forms.create"}`, `"forms.forms.batchUpdate"`, or the exact Forms method you need. Inspect the returned parameter and body definitions before writing.
- Create with `workspace_raw`: `{service: "forms", path: ["forms", "create"], body: {info: {title: "..."}}}`. Creation sets the title; use the returned `formId` for subsequent changes.
- Add or edit questions with `workspace_raw`: `{service: "forms", path: ["forms", "batchUpdate"], params: {formId}, body: {requests, writeControl: {requiredRevisionId}}}`. Derive `requests` from the schema and use the revision read from `forms_get`.
- For response pagination or filters, discover `forms.forms.responses.list` and use `workspace_raw` with `path: ["forms", "responses", "list"]`, `params: {formId, pageToken, ...}`. Follow returned page tokens when the request needs all responses.

## Workflow

1. For an existing form, ground its ID from the user's URL or Drive search, then read its questions, settings, and revision. For a new form, create it and read it before adding questions.
2. Build only the requested questions and settings. Preserve item IDs, question IDs, ordering, and unrelated settings during edits. Use targeted update masks. Configure quiz settings and grading only when requested.
3. Apply the schema-grounded batch update with the observed revision. If Google rejects a stale revision, read the form again and reassess the intended changes before another write.
4. Read the completed form back and verify its title, question order, required flags, and requested settings. Return only a link observed in the completed result or readback, such as `responderUri`; never invent a URL or claim a draft is published.

Use Drive tools for moving the form, sharing, and file metadata. Publishing, changing responder access, collecting email addresses, or sending invitations requires the user's request. Read responses only for the requested task and report the observed results.
