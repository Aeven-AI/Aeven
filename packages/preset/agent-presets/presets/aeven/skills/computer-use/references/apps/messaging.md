# Chat apps

Slack, Teams, WhatsApp, Telegram, Messages, Discord and Signal.

- Open the right conversation first and read its header (the person's or channel's name) before typing. Search inside the app rather than scrolling a long sidebar.
- Return sends in all of these apps; Shift+Return adds a line break. Slack lets each person swap the two: with three or more characters in the composer, a hint under it names the key that adds a line.
- Put the message into the composer with `set_value`, which inserts line breaks without sending, then read the composer back. `type_text` with `\n` sends a half-written message.
- Make sure the composer has focus before pressing Return. Slack types into the composer when nothing is focused, and Return elsewhere can open or send something else.
- Sending is a step to confirm unless their request named the recipient and the message. Show the final text when you ask.
- Several of these apps draw their window with web technology, so the tree can miss controls or show stale text. Cross-check with a screenshot when the tree and the result disagree.
- Attachments: use the app's attach button and the file dialog, or `clipboard_write` with a file path followed by paste.
