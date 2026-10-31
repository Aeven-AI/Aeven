---
name: avn-pr
description: "Files a short, clear pull request for the current branch. Use when the user asks to open, file or create a PR."
---

# avn-pr

Open one real PR whose title and description a busy reviewer can read in ten seconds.

## Steps

1. Check if a PR already exists for this branch (`gh pr list --head <branch>`). If it does, update it.
2. Diff the branch against its base, usually `origin/main`. Confirm the diff matches the goal and holds nothing unrelated.
3. Read the titles of a few recently merged PRs and copy their format.
4. Write a title that says what changed for the user and why it matters, not which function moved. Example: "Cut websocket frames by 70% with compression" beats "Negotiate permessage-deflate".
5. Write the description in this order:
   - The problem, in one or two plain sentences taken from the user's request.
   - The fix, in one or two sentences.
   - One line on how it was proven, if you have proof.
   - A closing line: `Created with <model> in Aeven.` Use the model name this session runs on. If the session does not report one, name only Aeven.
6. Scan the title, body and any attachments for secrets, tokens, private paths and personal data. Remove them.
7. Create the PR as ready for review, not a draft, so review bots run.
8. Print the PR URL that GitHub returned.

## Stop when

- GitHub returned a PR URL. Hand off to avn-watch-pr if the user asked for watching.
- `gh pr create` fails twice. If the error is a GraphQL rate limit, retry once through REST: `gh api repos/<owner>/<repo>/pulls -f title=... -f head=... -f base=... -F body=@body.md`. If that fails too, report the error.

## Rules

- No file-by-file change lists in the description.
- Do not post follow-up comments unless the request needs one. Use avn-pr-comments when it does.
- Never guess a model name.
