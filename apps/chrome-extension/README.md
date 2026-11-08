# Aeven browser extension

Lets the Aeven agent use the browser you browse with — Chrome, Brave, Edge, Arc, or another Chromium browser — through the Aeven desktop app.

- The agent opens its own tabs in the background, in a collapsed **Aeven** tab group, and drives only those, with the same tools, waits, and pointer as the sidebar browser.
- With your approval, the agent searches your history and bookmarks.
- The extension talks only to the Aeven desktop app on this computer, through the app's native messaging host (`io.aeven.browser`), which the app registers with each installed Chromium browser when it starts. No network port is opened.

## Build and load

```sh
pnpm --filter @aeven/chrome-extension build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `apps/chrome-extension/dist`. The manifest's `key` fixes the extension id (`jagdfmhjejiccpmnfieenehhijhjjgnf`) that the host manifest allows.
