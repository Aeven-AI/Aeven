# Aeven browser extension

English | [中文](README.zh.md)

Lets the Aeven agent use the browser you browse with — Chrome, Brave, Edge, Arc, or another Chromium browser — from the Aeven desktop app or from Aeven on the web.

- The agent opens its own tabs in front, in an open **Aeven** tab group, and drives only those, with the same tools, waits, and pointer as the sidebar browser. The extension runs each whole operation itself.
- Chrome shows "Aeven started debugging this browser" while the agent acts; the extension detaches from a tab 10 seconds after the agent's last action there, and the bar goes with it.
- With your approval, the agent searches your history and bookmarks.
- The desktop app reaches the extension through its native messaging host (`io.aeven.browser`), which it registers with each installed Chromium browser when it starts. Several browsers can be connected at once; each install has its own id, which agent tab ids carry. When none is connected and the agent opens a tab, the app starts the browser that has the extension and opens `connect.html`, which wakes the extension. No network port is opened.
- An Aeven web page on `aeven.io` reaches the extension directly (`externally_connectable`), which is how hosted Aeven uses your browser. Localhost pages may connect only to an unpacked development install.

## Build and load

```sh
pnpm --filter @aeven/chrome-extension build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `apps/chrome-extension/dist`. The manifest's `key` fixes the extension id (`jagdfmhjejiccpmnfieenehhijhjjgnf`) that the host manifest allows.
