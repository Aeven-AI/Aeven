# Agent Note: Artifacts, sharing and apps

Status: proposed

## Problem

Æven makes documents, slides, pages, sites, apps, images and videos, but they exist only as files in a workspace and as file cards in the conversation that produced them. There is no one place that lists what Æven made across conversations and devices, and the only thing a user can share is a single assistant answer through [`message-share`](../../../../packages/host/message-share/README.md), which publishes text and images and cannot carry a site or an app.

A user who asks for a website cannot put it online, a user who asks for an app cannot give it to someone else or keep it as a window on their own computer, and nobody can work on one artifact with another person. Hosting content that users and the agent produce also brings risks the product does not handle today: a tricked agent publishing private files, phishing and malware under an Æven domain, and user pages reaching the cookies of the main site.

## Proposal

A user asks Æven for something. It appears in the Artifacts list, ready to use. One Share button shares it by link or publicly at the user's own web address, and Unshare stops it. One button adds it to their computer. If it is a web app, anyone can open it in a browser and install it from there.

**Status: plan only.** Nothing is being built yet. The order is sharing first (Phases 0–1), then the Artifacts page and web apps, the backend and installs, and **working together on one artifact (co-editing) last, in Phase 7**.

This note combines three threads: the earlier Æven Apps plan, which is not in this repository, the plan for hosting user content on Æven, and the planning conversation of 24–26 November 2026. Where this note and the Apps plan disagree, this note is the newer decision.

**The one idea.** An artifact is a folder of ordinary files that Æven made. A web app is an artifact that runs in any browser. Where it is served from changes; the app does not.

| Word | Means |
| --- | --- |
| Files | The existing folder browser in the right sidebar. Already built. |
| Artifacts | The list of finished things Æven made: documents, PDFs, pages, sites, apps. |
| Share | Share an artifact publicly like a website at `<username>.aeven.app`, by link, or with people you choose. Unshare stops it. |
| Add to my computer | Give an app its own icon and window on the desktop. |

The Apps plan said the UI should never say "artifact". That rule is replaced: the sidebar item is called Artifacts.

## End goals check

Five things this setup must make possible (26 November 2026). Three work in the plan as written. Two need small additions, now included: **People you choose** as a Share option, and letting visitors pay for AI with their own Æven account.

| Goal | Possible? | How | When |
| --- | --- | --- | --- |
| 1. A shop with Stripe, built and put live by Æven | Yes, in two steps | **Step 1:** Æven builds the shop site, creates the products and Stripe Payment Links through the existing Stripe connector (every write asks first, per the Stripe skill), and shares it as Public. Stripe hosts checkout, receipts and orders, so no backend is needed. **Step 2:** a cart and live stock need a checkout function on the built-in backend. It creates Stripe Checkout sessions with the owner's Stripe connection and records paid orders from Stripe's webhooks in the app's data store | Step 1: Phase 1. Step 2: Phase 3, as a new "payments" capability of the backend |
| 2. A hair-change app, also installed locally, AI billed to the user | Yes | A web app that edits photos through an image capability. Opened or installed inside Æven, the bridge bills the user's own Æven balance. Installed by someone else from the browser, the backend bills either the owner (capped, with a visible notice) or, if the owner picks it, the visitor's own Æven account after they sign in | Backend image calls: Phase 3. Install in Æven: Phase 4. The image capability and "visitor pays" are additions |
| 3. A presentation for a small group, invite link only | Yes | A Slides artifact shared as **Anyone with the link**: an unlisted random address that search engines are kept away from. For tighter control, use People you choose | Phase 1 |
| 4. Docs or apps only for people you pick | Yes, with the addition | **People you choose:** email invites. Each invited person signs in to their Æven account, or creates one, and then has access. The server checks access before serving, so these items live in a `shared/` folder that the static rule never serves, behind an access check (nginx `auth_request` to the API) and with no caching | Can view: Phase 2, with the viewer sign-in on `aeven.io`. Can edit: Phase 7 |
| 5. Access removed at any time | Yes, with honest limits | **Unshare** stops a link at once: the next time anyone opens or reloads it, it is gone. With People you choose you can remove one person. Backend calls (data, AI, payments) stop immediately. Limits: a file someone downloaded, or an installed app's offline copy, keeps the last version they had; no system can pull back a copy someone saved | Unshare: Phase 1. Per person: with goal 4 |

## Decisions made

| Topic | Decision |
| --- | --- |
| Sidebar order | Files first, Artifacts directly below it. |
| Public address | `<username>.aeven.app`, with each artifact at `/<name>/`. |
| `chat.aeven.app` | Becomes a redirect to `chat.aeven.io`. `aeven.app` is for user content only. |
| Certificates | Nothing to buy. Cloudflare's free certificate and the one already on pink both cover `*.aeven.app`. |
| How publishing works | Each account folder has a `public/` folder. Whatever is in it is served. |
| Share and Unshare | Sharing copies the finished files into `public/<name>/`. The working files stay where they are, so Æven can keep editing them. Unsharing deletes the copy. Decided on 26 November 2026; replaces "move in, move back". |
| Share choices | A Share switch with three options: Public, Anyone with the link, People you choose. Off means private. |
| People you choose | Invited by email. The person must have an Æven account, or create one. The invite email carries a one-time link, and the account that accepts it gets the access. |
| Link sharing | Works like sharing an assistant answer: a managed snapshot, listed in Settings, and Unshare makes the link invalid at once. |
| Approval | Every publish is approved. The user pressing Share or "Update the shared version" is the approval. When Æven publishes from chat, it shows a card every time. |
| Sign-in | Always on `aeven.io`. A page on `aeven.app` never shows a sign-in form. |
| Apps | Web apps first. They run on their own in a browser and are installable from the browser. |
| Desktop powers | A bridge adds them when the app runs inside Æven. |
| Lock-in | The app and its data stay ordinary files that work without Æven. |
| Build order | Plan only for now; nothing is being built yet. Sharing first, co-editing (the Can edit role and live editing) last, in Phase 7. Decided on 26 November 2026. |

Share replaces the encrypted "Only me" and "Anyone with the link" links from the Apps plan. Private is covered by synced files. Link sharing stays, but as an unlisted link the server hosts (not encrypted), next to Public. Decided on 26 November 2026.

## User experience

The test for every screen is whether a regular user can do it without learning anything. Claude's artifacts are not simple enough: they have several kinds of link, a publish step, versions and capability settings.

### Three moves

1. **Æven makes something.** A card appears in the chat.
2. **Click the card.** It opens next to the conversation, whatever it is.
3. **Press Share.** A switch turns on and the link is copied.

There is nothing to save, name, upload or configure.

### Right sidebar

- **Files** stays first and stays the folder browser.
- **Artifacts** sits directly below it. It lists finished things Æven made, this conversation's only, with a See all link that opens the Artifacts page.
- Each entry shows what it is (document, page, site, app) and one sharing status: Private, Shared with people, Shared by link or Public. An app added to this computer also shows On my computer; that mark is per device and is not synced.
- The sidebar's content menu is a fixed list of kinds in `ui-sidebar-select`. Artifacts is a new kind in that list.

### Artifacts page

The right sidebar shows this conversation's artifacts. The left sidebar gets an **Artifacts** link that opens a page with everything Æven has made, across all conversations and workspaces, on every device. Everything Æven creates ends up there automatically, including generated images and videos, with nothing to save or add. It works like Claude's artifacts page, in Æven's style.

**The link.** It sits in the left sidebar's nav, directly under Bots. It's built the same way: a new `ui-artifacts` package registers a row in the `sidebar.nav` slot (Bots uses `order: 0`; Inspiration already holds `order: 1` in `ui-imagine`, so Artifacts takes `order: 1` and Inspiration moves to `order: 2`) and owns the `/artifacts` routes, so direct links and refresh work.

**The page, `/artifacts`, from top to bottom:**

- **Header:** "Artifacts" and a count.
- **Search** across titles, conversation titles and kinds, with results as you type. Searching the text inside documents can come later.
- **Filters** in one row:
  - Kind chips: All · Documents · Slides · PDFs · Pages · Sites · Apps · Images · Videos.
  - Status: Any · **Shared** (any way) · Public · Shared by link · Shared with people · Private · On my computer · Shared with me.
  - Workspace: All, or one workspace.
  - Sort: Recently edited (default) · **Most visited** · Recently created · Name. Most visited counts visits to shared artifacts over the last 30 days; private ones have none and come last.
- **Grid of cards**, four to a row (three below 768 px), exactly like the image and video grid on Inspiration. Sorted by date, the grid is grouped into Today, Yesterday, Previous 7 days, Previous 30 days, then by month; sorted by Most visited or Name, there are no groups. A grid/list toggle sits next to Sort; list view adds columns for kind, status, visits, workspace and date.
- **Composer at the bottom**, as on `/bots`, reading "Make something…". A few idea chips fill it without sending, for example "A landing page for my side project" or "Slides from my last meeting notes".
- **Empty state** before anything exists: one line and the idea chips.

**Each card shows**

- **The same card as the image and video cards** on Inspiration (`ui-imagine`): 4:5, 30 px corners, the preview filling the whole card and zooming slightly on hover, and the dark fade at the foot that keeps white text readable.
- **Text and status on the picture:** a status pill at the top left (Private · With people · By link · Public), plus an On my computer mark on apps added to this device; at the foot, the title in white and one line under it, for example "Site · edited 2 h ago · 1.2k visits". Visits show only on shared artifacts.
- **The preview depends on the kind:** an image is itself; a video plays muted on hover; a document or PDF shows its first page; slides show the first slide; a site or app shows a screenshot. A plain-text document with no visual first page shows its title and opening lines set on a paper-coloured card, so text still reads as text.
- **While a preview renders,** the card uses the same loading surface as Inspiration: a spinner with the title in ink.
- **On hover,** **Share** appears at the top right, with a menu: Open, Open conversation, Show in Files, Download, Add to my computer (apps only), Earlier versions, Delete.
- Clicking the card opens the full-page view.

**Full-page view, `/artifacts/<id>`.** The artifact fills the page, using the same viewer as the right sidebar. The top bar holds the title, status, **Share**, **Open conversation**, Download and the menu. For an app, **Add to my computer** sits next to Share. Back returns to the grid with the search and filters as they were.

**What it needs underneath**

- **The artifact index** from Phase 2: each artifact's title, kind, status, workspace, the conversation it came from, its versions and timestamps. Keeping it in an account-sync document means the page looks the same on every device and on chat.aeven.io.
- **Preview images**, rendered by the host whenever an artifact gets a new version and stored with it. The desktop app already ships a browser engine to render pages; on chat.aeven.io the server renders them.
- **Search** over the index alone, so it's instant without a server round trip. Visit counts for Most visited come from the server, which counts views of each shared artifact per day: a counter only, with no cookies or visitor tracking.
- **Copy** in Chinese, English and Spanish, like the rest of the UI.

**Filling the page with everything made before.** This is possible, because the host can already rebuild every turn's produced files from the session log. The `turnDeliverables` unit in `session-turn-outline` serves them, and the chat's file cards read it. It works from the tools' own records (the arguments of successful `write`, `edit` and `str_replace_editor` calls, plus the `producedFiles` metadata that image and video tools return), never from what the reply text says. The backfill runs that over every stored conversation once:

1. **When:** the first time the Artifacts page ships, as a low-priority background job. The page shows "Finding what Æven made… 340 of 1,200 conversations" and fills in as it goes. After that, each finished turn adds its files straight away.
2. **What counts:** files Æven *created*, not edits to the user's own files. Only artifact kinds count: documents, slides, PDFs, pages, sites, apps, images and videos. A folder with an `index.html` becomes one Site or App card, not a card per file. Code and config files inside a repository are left out, so a coding session doesn't fill the page with `.ts` files.
3. **Files that moved or were deleted:** many results keep a stored copy (an attachment id in the log), so the card can still show and open that copy, marked "Original file moved". With no copy left, the item is hidden by default and listed under a **Missing** filter, so nothing silently disappears.
4. **Shared conversations** from today's Share button join the list as their own kind.
5. **Other devices:** each device backfills the conversations whose logs it holds and adds them to the synced index, so the page ends up the same everywhere. A card for a file that lives on another computer opens once workspace file sync has brought it over, or from its stored copy. On chat.aeven.io the server runs the backfill over the user's own workspace.
6. **Previews** are rendered lazily as cards scroll into view, so the backfill itself stays fast.

To check before building: whether the oldest conversation logs, from before `producedFiles` metadata existed, still record generated images in a form the reader understands. Some early images may need a second pass that looks for image attachments in tool results.

### Share

- **It's called Share, not publish.** The button, the menus, the chat ("share this") and every label say Share and Unshare. It works like the existing Share button on a conversation.
- **One Share sheet: a switch and three options.** With the switch off the artifact is private: only you, on your own devices. That is the default. With it on, pick one:
  - **Public:** like a website, at a readable address such as `olivier.aeven.app/portfolio/`. Search engines may index it and anyone can find it.
  - **Anyone with the link:** an unlisted link with a random part, such as `olivier.aeven.app/x7Kq9mPz/`. It's not listed anywhere, search engines are told to stay away, and only people you send it to will find it. It works like sharing an assistant answer: the link shows a snapshot, sharing again refreshes the same link, and Settings lists it.
  - **People you choose:** add email addresses. Each person gets an invite email with a one-time link. They sign in to their Æven account, or create a free one, and then have access; the item appears on their Artifacts page under Shared with me. The people list shows each invited address and the account that accepted it. Remove anyone at any time. Until Phase 7 everyone invited can view; after that each person also gets a role, Can view or Can edit.
- **Sharing makes a copy.** The shared version is a copy of the finished files; the working files stay where they are. The sheet shows "Going live…" while the copy reaches the server and is scanned, then copies the link, so a copied link always works.
- **Unshare** is the same switch, turned off. The link stops working at once: anyone opening or reloading it sees "This isn't shared." A page someone already has open stays on their screen until they reload. The files stay in the user's artifacts.
- **Signing in happens on `aeven.io`.** A shared page never shows a sign-in form of its own, so a user page can't fake one.
- **Switching from a link to Public** gives the artifact its readable address, and the old link redirects to it. Switching back to a link creates a new random link.
- **The address is assigned, not requested.** On the first share Æven picks an address from the user's name, such as olivier.aeven.app, and shows it with a small "change" link. Settings has the same field.
- **Asking in chat does the same thing.** "Share this", "share this with Anna and Ben" or "put this online" opens the same Share sheet, filled in.
- **Changing something shared.** When Æven edits a shared artifact, the shared copy does not change. The card offers one button: "Update the shared version". It replaces the copy as a whole and keeps the same address.
- **Everything shared in one place:** the Artifacts page filters by sharing status, and Settings lists every shared item with Unshare, and with the people list for items shared with people you choose. Shared conversations join the same list.

### Working together on one artifact

People you invite with **Can edit** work on the same artifact, as in Claude. This is the last phase of the build (Phase 7); until then, People you choose can only view. There's one copy, and everyone sees each other's changes live.

**Roles**

| Role | Can |
| --- | --- |
| **Owner** (one) | Everything: edit, invite, change roles, remove people, change sharing, Unshare, delete. Ownership can be handed to an editor later |
| **Can edit** | Open it, edit it directly, ask their own Æven to change it, see and restore earlier versions, share the link if the owner allows it |
| **Can view** | Open it and download it, unless the owner turns downloads off |

**How it feels**

- **Invite:** in the Share sheet, type an email, pick Can view or Can edit, press Invite. In chat, "share this with Anna as editor" fills in the same sheet.
- **For the invitee:** an email, and the artifact appears on their own Artifacts page under a **Shared with me** filter, with the owner's name on the card ("Shared by Ollie · Can edit").
- **Editing a document or slides:** both people type in it at the same time, with each other's cursors and names, like a shared doc.
- **Changing a site or app:** an editor asks their own Æven ("make the buttons bigger"). The change lands as a new version marked with their name, and everyone with it open sees the update live.
- **Two changes to the same file at once:** the later save doesn't overwrite. Both versions are kept and the card shows "Two versions" with Keep this one / Keep the other, the same pattern as the workspace file-sync note.
- **Presence:** small avatars at the top of the full-page view show who has it open.
- **History** lists every version with who made it and when, and anyone who can edit can restore one.
- **Who pays:** each person's AI edits are billed to their own Æven balance. The owner never pays for an editor's AI.
- **What stays private:** only the artifact's files are shared. The conversation that made it, the owner's memory and other files stay with the owner. An editor's Æven works from the shared files plus their own conversation.
- **Removing someone** takes effect immediately: open pages close, the item disappears from their Artifacts page, and their device deletes its cached copy at the next sync. A copy they downloaded earlier can't be pulled back.

**How it's built**

- **One source of truth:** when an artifact gets its first editor, its files move to a shared copy on Æven's server. The owner's own files stay in sync with it both ways, so the owner's disk still has the latest version.
- **Membership:** a per-artifact record of owner, members and roles, checked by the server on every read and write. This is the same idea as the membership record in the proposed multi-participant sessions note, so both can share one model.
- **Live editing:** documents and slides are Yjs documents, the same technology account sync already uses. They need a channel on the relay that members of different accounts can join, which today's per-account relay doesn't do yet.
- **Sites and apps:** whole-file versions with the author recorded, plus the two-versions rule above.
- **Comments** on a part of an artifact can come later.

### Add to my computer

- Shown only on apps.
- One plain-language prompt says what the app will be able to do.
- The app gets its own window, and later its own icon in the Dock or Start menu.

### Kept out of sight

- Earlier versions are one menu item, not a toolbar.
- The `public/` folder and the copying of files are never mentioned in the UI, except in the Files browser where the folder is visible.
- All copy ships in Chinese, English and Spanish, and says Æven.

## Apps

### One app, three levels

The app is one set of files. Nothing is rebuilt or converted to move between levels.

| Where it runs | What it can do |
| --- | --- |
| Any browser, from `<username>.aeven.app/<app>/` | Everything a web page can, plus the built-in backend |
| Installed from the browser | The same, with its own icon and window, and offline use |
| Opened in Æven on the desktop | All of that, plus the bridge |

### Installable from the browser

- Every app carries a manifest file, icons and an offline script. The agent's skill and templates add them.
- Chrome and Edge offer "Install app". Safari offers "Add to Dock". The app also shows its own Install button.
- An installed app needs no Æven on that computer, so anyone can install an app someone shared.
- This covers "an app for other people". A fully standalone native app per artifact was considered and rejected: it needs a runtime of over 100 MB or a separate wrapper, and signing and notarization for every generated app.

### Built-in backend

Front-end apps that save in the browser need nothing more. Apps with shared data, logins or model calls use one backend that Æven provides, called through a small script.

- **Data:** a per-app store for records and uploaded files.
- **Visitors:** optional sign-in, so an app can have its own users.
- **Model and image calls:** billed to the app's owner with a daily cap and a visible notice to visitors, or to the visitor's own Æven account after sign-in when the owner chooses that.
- **Limits:** quotas and rate limits per app, charged through the existing cloud billing.

There is no custom server per app. That would mean long-running processes per user, which is costly and the largest security risk. Small on-demand functions could be added later. [Full-stack apps](#full-stack-apps) describes how other builders run app server code and databases, and a route on Cloudflare Workers that runs no long-lived process.

### The bridge

The bridge is the set of desktop powers an app gets inside Æven. The app checks whether it is present and enables the extra features when it is.

| Power | What the app gets | When |
| --- | --- | --- |
| Agent | Hand Æven a task and show the result | First |
| Memory | The user's memory, limited to granted domains | First |
| Models | The user's own models, local or bring-your-own | First |
| Notifications | Native notifications | First |
| Folders | Read and write inside folders the user picks | First |
| Tray, hotkeys, overlay | Desktop presence | Second |
| Connectors | Gmail, calendar, Slack and others, per connector | Last |
| Commands, terminal | Run listed programs | Last |
| Screen, computer use | See or operate other apps | Last |

The agent power is the one no browser-only app can have: every app gets an assistant behind its buttons.

### How Claude does it

From reading the Claude desktop app, version 6.28899.6. The code is minified, so some of this is inferred from names and messages.

- The app is the artifact's web page, loaded from claude.ai in a dedicated window of Claude.
- A bridge gives the page a Dock icon and badge, a tray item, global hotkeys, menus, notifications, file reading, processes and a terminal.
- Each power is refused until the person allows it, with a "full access" tier above the normal one.
- On macOS Claude writes a small locally signed `.app` per install. Opening it tells Claude to open that artifact's window.

Æven uses the same window-and-bridge pattern with one difference: the app runs from the user's own files, not from a cloud address.

### Does Æven need to be running?

- **Browser-installed apps:** no.
- **Apps opened in Æven:** yes, but the user should not notice. Clicking the app's icon starts Æven quietly in the background and shows only the app's window. Æven already has a background mode with a tray icon.
- **Launchers:** a small generated `.app` on macOS, a Start menu shortcut on Windows, a `.desktop` file on Linux.

### Keeping it from being lock-in

Claude's version is lock-in: the page lives on claude.ai and only opens inside Claude. Æven's bridge also creates dependence, since an app that uses memory or the agent needs Æven. Three properties keep the user free to leave.

- **The app is the user's files**, on their disk and at their address.
- **It runs without Æven** in any browser. Only the extra powers need Æven.
- **The bridge is an open spec**, as the Apps plan proposes, modelled on the skills format.

Two rules keep that true:

1. Every template works without the bridge first. Bridge features are added on top.
2. App data is stored as readable files in the app's folder, not inside Æven's own database.

## Hosting

### What already exists

| Piece | State |
| --- | --- |
| Per-account jail with npm and pip through the egress proxy | Live on pink. The agent can build a React app in it today. |
| Account folders, synced from desktops | Live. 492 GB volume at 1% use, 31 accounts when checked on 24 November. |
| Storage billing | Live. 1 GiB included, then charged per GiB-month. |
| nginx 1.31.9 with a static-site example | Live. `playground.aeven.io` is a static vhost. |
| Certificate for `*.aeven.app` | On pink, valid to 2041. Cloudflare's free certificate covers the same names. |
| Usernames | Do not exist. Accounts only have 32-hex ids. |

### Why `aeven.app`

- **Free with Cloudflare in front.** Names one level deep are covered. Tested on 25 November: `https://olivier.aeven.app` gets a valid certificate and then fails with a 521, because the wildcard DNS record still points at the old dead server.
- **`aeven.io` stays out of it.** User pages cannot touch cookies for chat, webmail or the website, and a bad page cannot get the main domain flagged.
- **Rejected: `<username>.public.aeven.io`.** Two levels deep. Tested: Cloudflare refuses the TLS handshake. It would need Cloudflare's paid certificate add-on, or DNS-only with no Cloudflare in front.
- **Rejected: `<username>-public.aeven.io`.** Works for free, but browsers can never be told to treat those names as separate sites.

### The public folder

- Each account folder gets `public/`, created next to `chats/` by the `working-directory` package.
- It is part of the synced Æven folder, so `~/Documents/Aeven/public` on a desktop reaches pink the same way.
- Its size counts against the account's existing disk quota.
- **Sharing copies, never moves.** `public/<name>/` holds the live version. The working files stay where they are, so chat file cards, Show in Files and Æven's own edits keep working.
- **Updating** replaces `public/<name>/` as a whole, so a visitor never gets a half-updated site.
- **Unsharing** deletes the copy. Nothing has to be moved back, so no record of where an item came from is needed. Items the user dropped into `public/` by hand have no other copy, so those go to an `unpublished/` folder.
- For a site built from source, only the built output is copied.
- **Two sibling folders** hold the other share options, with the same copy rules:
  - `links/` for Anyone with the link. Served at the same address scheme, with "do not index" and "do not pass on this address" headers and no caching.
  - `shared/` for People you choose. Never served as plain files; every request goes through the access check.
- **From a desktop**, the copy reaches pink through the existing folder sync. An artifact made in a project workspace outside the Æven folder is copied into the Æven folder's `public/` the same way.

### Usernames

- Stored per account in servers/node. Lowercase ASCII letters, digits and hyphens, 3 to 32 characters, no leading or trailing hyphen, no `xn--`.
- A reserved list: `www`, `api`, `chat`, `admin`, `mail`, `aeven` and similar.
- A released or renamed name is never given to another account, or old links could be taken over.
- On claim, the API writes a link `/srv/aeven-public/<username>` pointing at the account folder. The `aeven-api` unit needs that directory added to its writable paths.
- Assumption to confirm: account folders on pink are named by `users.userId`.

### Serving

One nginx vhost on pink. `public/` and `links/` are served as static files, with no proxy to the Host and no cookies. `shared/` is the one exception: nginx asks the API on every request whether this signed-in visitor may see the item.

```nginx
server_name ~^(?<user>[a-z0-9]([a-z0-9-]{1,30}[a-z0-9]))\.aeven\.app$;
root /srv/aeven-public/$user;              # link to the account folder
disable_symlinks on from=$document_root;   # "public" and everything below: no links
location ~ /\. { return 404; }
location / { try_files /public$uri /public$uri/index.html @app; }
add_header X-Content-Type-Options nosniff always;
# Cache-Control is set per file type; see Caching below.
```

- **Caching, for speed and for instant Unshare.**
  - HTML in `public/`: `no-cache`. The browser checks each time and usually gets a tiny "not changed" answer, so updates and Unshare show at once.
  - Fingerprinted assets in `public/` (such as `app.3f9a.js`): cached for a year and marked immutable, so Cloudflare and the browser serve them without asking pink. The app templates emit fingerprinted names.
  - Other files in `public/`: about a minute.
  - Everything in `links/` and `shared/`: never cached, so Unshare and removing a person are complete at once.
  - Unsharing a Public site also clears that site's files from Cloudflare's cache.
- **Compression.** Brotli or gzip for text files.
- **Trailing slash.** `/budget` redirects to `/budget/`, or the app's relative links break.
- **Missing addresses** all show one Æven page, "This isn't shared.", with a 404 status.

- **No folder listings.** nginx's listing feature does not honor the symlink check.
- **Deep links.** An unknown path inside an app folder serves that app's `index.html`, so `…/budget/favorits` opens the app. The `@app` step above stands for that per-app fallback and is not written yet.
- **Unknown usernames and empty folders** return the same 404.
- **Per-user rate, connection and speed limits**, and per-site access logs.
- **DNS.** Repoint the `*.aeven.app` wildcard record to pink.
- These rules have not been tested on pink.

### Links inside apps

A link written as `/favorits` works on a custom domain and breaks at `olivier.aeven.app/budget/`. Templates must make the app detect its own starting address when it loads and build links from that. The agent's skill has to enforce it.

### Custom domains

A later, paid add-on.

- **Two levels.** `olivier.com` shows the whole site. `mybudgetapp.com` shows one app at its root.
- **For the user.** Type the domain in Settings, add one DNS record, wait for confirmation.
- **Ownership check.** A domain is activated only after Æven sees the DNS record it asked for.
- **Certificates.** Let's Encrypt on pink, issued when the domain is added. Cloudflare's custom-hostname service is the alternative that keeps Cloudflare in front.
- **One official address.** Once a domain is connected, the `aeven.app` address redirects to it and keeps the rest of the path.
- **Start with subdomains** such as `app.olivier.com`. A bare `olivier.com` needs a record type that not every DNS provider supports.
- **Installs are tied to the address.** People who installed an app from the old address have to install it again from the new one.

## Full-stack apps

Lovable, Z.ai and Kimi host complete apps with server code and a database, built and published from chat. This section records how each does it, researched on 27 November 2026 from their documentation, their published npm packages, projects their users exported to GitHub, DNS and response headers, and vendor case studies, and what Æven would need to offer the same.

### How three builders do it

| | Lovable | Z.ai | Kimi |
| --- | --- | --- | --- |
| Generated stack | Vite, React and shadcn; since May 2026 TanStack Start with server rendering per route | Next.js 16 standalone server, Prisma on SQLite and shadcn, run with Bun | Vite, React and shadcn; the backend adds Hono, tRPC and Drizzle on MySQL |
| Preview while editing | A dev server per session in a sandbox, about one million sandboxes a day; first on Modal, now on their own gVisor scheduler across clouds | A container per chat starts the dev server itself; the preview is `preview-chat-<id>.space-z.ai` in an iframe | A Debian container per session; the full-stack preview sometimes has to be started again by hand |
| Published apps run on | Cloudflare Workers: each publish builds the app, pre-renders the static routes and deploys one Worker, at `<name>.lovable.app` | Alibaba Cloud Function Compute, a serverless container running the Next.js server behind Alibaba's web firewall, at `<random>-d.space-z.ai` | nginx for static builds; full-stack sites are built from a generated Dockerfile; at `<name>.ok.kimi.link` |
| Database | Supabase: the user's own organisation, connected by Supabase's sign-in and managed through its Management API, or Lovable Cloud, a Supabase instance Lovable owns and bills from credits | A SQLite file packaged with the deployment and kept inside the instance, so data does not reliably survive a redeploy | One logical MySQL database per site on a shared TiDB Cloud cluster, handed out from a warm pool and scaled to zero when idle |
| Sign-in in generated apps | Google, Apple, Microsoft or "Sign in with Lovable" | NextAuth | A Kimi account, or username and password on the site's database |
| AI inside apps | An AI gateway SDK, billed to the owner | An internal gateway keyed to the chat and the user | Not documented |
| Abuse controls | User domains on the Public Suffix List, a check while the prompt is typed, a Safe Browsing check before going live, daily scans, and security checks in the publish dialog | Web firewall and content review | A separate domain and takedown on report |
| Open source | Small parts only, such as their Rust dev server | No; the template ships inside every exported project | No; Moonshot's agent SDK runs its tools on swappable sandboxes but includes no hosting |

What the three share:

- **One fixed template and skill.** Kimi's database vendor reports that standardising on one set of frameworks and starter files raised the share of generations that work.
- **A live preview.** A dev server runs while the agent edits, and the agent checks it with lint, type checks, the dev server log and a headless browser.
- **An explicit publish.** The user's click builds and deploys a snapshot to a wildcard subdomain on a domain separate from the product.
- **A database per app, managed for the user.**
- **Sign-in with the builder's own account.**
- **Abuse controls from the first release.** Proofpoint counted tens of thousands of Lovable addresses a month in phishing email from February 2025, before Lovable added its checks.
- **Database access checks at publish.** Generated apps without row-level access rules exposed their data (CVE-2025-48757, CVSS 9.3), which is why Lovable checks database access before publishing.

### What Æven has

- The per-account jail on pink, with npm and pip through the egress proxy.
- Account folders synced from desktops, and storage billing.
- Cloudflare in front, and the certificate for `*.aeven.app`.
- Credit billing for inference and cloud use.
- The static hosting in this note: `public/`, `links/` and `shared/`, the nginx vhost, and the scan before serving.
- On the desktop, the agent can already build an app and run its dev server locally, and the sidebar browser can show it.

### What Æven would need

1. **A template and an app skill.** Vite, React and shadcn with address-independent links, as in [Links inside apps](#links-inside-apps), plus one backend recipe. This is prompt and template work.
2. **A hosted preview.** The desktop already has one. The hosted Host needs the jail's dev server reachable through a preview proxy: a token-checked preview address, iframe-safe cookies, and a sandbox that sleeps when idle.
3. **Server code without a server per app.** Cloudflare Workers for Platforms runs each customer's code in its own V8 isolate, scales to zero and needs no server of Æven's own; Lovable publishes this way. It meets the reason [Built-in backend](#built-in-backend) gives against a server per app, since no long-lived process runs. Its limit is the Workers runtime: no native Node modules and no local SQLite file, so the database is a separate service. Containers per app, as Z.ai and Kimi use, would mean running a container platform.
4. **A database per app,** offered two ways:
   - **Managed:** Cloudflare D1, one SQLite database bound to each app's Worker, with R2 for uploaded files. It is per app and costs nothing while idle, as Kimi's TiDB setup does, and pairs with Workers.
   - **The user's own Supabase:** connected through Supabase's sign-in and Management API, as Lovable does, with every migration shown for approval and secrets kept in Supabase.
5. **Sign in with Æven, and AI billed through Æven.** The accounts and the credit balance exist. The visitor-pays and owner-pays rules in [End goals check](#end-goals-check) apply here.
6. **A version per agent turn.** A git commit per turn with rollback, as all three do; Share publishes a snapshot.
7. **Checks at publish.** On top of [Nothing is served until scanned](#nothing-is-served-until-scanned): a phishing check, a check that every table has access rules, and takedown.
8. **A charge for each live site.** A small fee from the credit balance while a site is live, as Kimi charges, with quotas per account.

### Order

- Sharing built static apps first: Phase 1 as written.
- Then Workers for Platforms with D1 and Sign in with Æven as the full-stack tier, with the user's own Supabase beside it. This would replace the per-app data store of [Phase 3](#phase-3-built-in-backend).
- The hosted preview proxy when hosted Æven builds apps; the desktop does not need it.

## Security and abuse

### Holes found while planning, and their fixes

| Hole | Fix |
| --- | --- |
| A jailed command replaces `public/` with a link to `/`, and nginx serves the server's files | The username link points at the account folder and nginx adds `/public` itself, so that name is inside the checked path |
| Folder listings bypass the symlink check | No listings |
| A tricked agent copies private data into `public/`, where it is world-readable at once | Agent writes to `public/` need the user's approval |
| A user page overwrites the session cookies of the main site | User content lives on `aeven.app`, away from `aeven.io` |

### Agent writes need approval

- **Hosted.** The jail mounts `public/`, `links/` and `shared/` read-only. A `publish` tool shows an approval card with the exact address and the files added, changed and removed, then the Host copies the files in.
- **Every time.** The card appears on every publish from chat, not once per conversation, so an agent that was tricked later in a conversation cannot add files to a folder approved earlier.
- **The user's own press** on Share or "Update the shared version" is the approval; no second card follows.
- **Desktop.** The sandbox policy treats the same three folders under `~/Documents/Aeven` the same way.
- **The user.** Dragging files into `public/` by hand needs no approval.

### Nothing is served until scanned

Files reach `public/` through the publish tool or through desktop sync, so a check at publish time is not enough. nginx can read a file only after the scanner grants it access. A new or changed file arrives without that access.

- **File types.** Web and document types are allowed. Executables and installers are refused.
- **Malware.** ClamAV on every file.
- **Phishing signs in HTML.**
  - A password or card field in a form that posts to another domain.
  - Login pages using another organisation's name.
  - Instant redirects to other sites.
  - Hidden iframes and heavily obfuscated scripts.
  - Crypto miner or wallet-drainer signatures.
- **Later.** Checking outbound links against Google's blocklist, and a cheap model review of borderline pages.

A flagged file stays unserved. The user sees why in Settings and can ask for a review.

### One bad site can affect the others

Google Safe Browsing can flag all of `aeven.app` for one phishing page. `aeven.io` and chat are unaffected.

- **Public Suffix List entry for `aeven.app`.** Browsers then treat every user site as a separate site, and blocklists tend to judge each one separately. Listing takes weeks.
- **Who can publish.** Accounts with credit only, at least at the start.
- **`noindex` on new sites** until the account has some history.
- **Takedown.** Delete the username link and purge the Cloudflare cache.
- **Alerts.** Register `aeven.app` in Google Search Console, and publish a report-abuse address.

### Protecting the main site

- The API's session cookies are named `accessToken` and `refreshToken`. Renaming them with the `__Host-` prefix stops any sibling site from overwriting them. With user content on `aeven.app` this is a second layer, not the only defense.
- The hosted Host's own browser cookies have not been audited.

### Bridge rules

1. **The bridge exists only inside Æven's own windows.** A hosted page in a normal browser can never reach the desktop. It can show an "Open in Æven" button.
2. **Installing into Æven takes a fixed local copy.** Æven records a fingerprint of the app and runs that copy. An update applies only after the user sees what new access it asks for.
3. **Deny by default, in tiers.** Nothing is granted until the app declares it and the user allows it. Files, commands, connectors and screen access are asked for again after every update and shown as a badge on the window.
4. **Agent tasks from an app run with the app's grants only.** Anything that sends or deletes still asks the user.

The Apps plan's security section still applies to apps inside Æven: memory stays in the Host, each app has a model budget, and one switch revokes everything.

### Visitor data

Once apps collect data from visitors, the app's owner is responsible for it. The terms need to say so.

## Build order

Nothing is built yet. The Apps plan says this work starts after the official launch, and that assumption is kept. No time estimates are given here; the Apps plan's week counts were for a different scope.

### Phase 0: groundwork

Small, and worth starting early because the first item takes weeks to land.

- Submit `aeven.app` to the Public Suffix List.
- Repoint the `*.aeven.app` DNS record to pink.
- Turn `chat.aeven.app` into a redirect.
  - Replace its nginx vhost.
  - Remove it from the hosted app's trusted hosts and the API's allowed origins.
  - Drop it from the maintenance Worker.
- Rename the session cookies with the `__Host-` prefix.
- Add usernames in servers/node.

### Phase 1: share what Æven made

- The `public/` and `links/` folders, the nginx vhost with its caching rules, and the scan-before-serve gate.
- The `publish` tool with its approval card on every publish, and the desktop policy rule.
- The Share switch with Public and Anyone with the link, the "Going live…" state, the assigned address, and the shared list in Settings.
- Test the nginx rules against hostile cases: `public` as a link, links inside it, dotfiles, FIFOs.

After this phase a user can ask for a website and share it.

### Phase 2: Artifacts and installable web apps

- The Artifacts item in the right sidebar, below Files, and the Artifacts page from the left sidebar (/artifacts, with search, filters, date groups and preview images).
- The artifact index: where each one came from, its versions and its state.
- The app skill and templates, with the manifest, icons, offline script and address-independent links.
- The Install button inside apps.
- People you choose, view only: the `shared/` folder with its access check, email invites with a one-time link, the viewer sign-in on `aeven.io`, and the per-artifact membership record. Can edit comes in the last phase.

After this phase a user can ask for an app, share it, and anyone can install it from a browser.

### Phase 3: built-in backend

- Data store first, then model calls, then sign-in for an app's own visitors, which reuses the Phase 2 viewer sign-in.
- Quotas, rate limits and billing per app.
- Needs its own security design before building.

### Phase 4: apps inside Æven

- "Add to my computer": the app in its own Æven window, from a fixed local copy.
- The first bridge: agent, memory, models, notifications, picked folders.
- Local serving with the same backend calls.
- The launcher per operating system.

### Phase 5: desktop extras and custom domains

- Tray, hotkeys and overlay windows.
- Custom domains as a paid add-on, subdomains first.
- Installing apps made by other people into Æven.

### Phase 6: high-risk powers

- Connectors, commands and terminal, screen access.
- The Apps plan gates this on a second engineer for security review.

### Phase 7: working together (last)

- The Can edit role, the shared copy on Æven's server, and the owner's files kept in sync with it.
- Whole-file versions with authors, the two-versions rule, presence and history with restore.
- A relay channel that members of different accounts can join, then live co-editing of documents and slides.
- Handing ownership to an editor; comments after that.

After this phase several people can work on one artifact, as in Claude.

## Open decisions

| Decision | Recommendation |
| --- | --- |
| Drop the encrypted "Only me" and "Anyone with the link" links from the Apps plan? | Decided: drop the encryption, keep the choice. Synced files cover only me; Anyone with the link becomes an unlisted link the server hosts, next to Public. It removes a server component and an unscannable way to host phishing. The cost is the "server can't read shared files" promise for shared items. |
| Address assigned on first share, or chosen first? | Assigned, with a "change" link. |
| Public documents: a clean Æven viewer page, or the raw file? | Viewer page. |
| How often the agent must ask before publishing | Decided: every time, with the list of files added, changed and removed. The user's own press on Share counts as the approval. |
| People you choose: one-time invite link, or strict email match? | One-time invite link. It also works for accounts made with Apple's hidden email or through X, which have no matching address. The owner sees which account accepted and can remove it. |
| Who can publish | Accounts with credit, at least until the Public Suffix List entry lands. |
| Launch with front-end apps only, backend right after? | Yes. The backend is where most of the work and risk sits. |
| Bridge only inside Æven windows? | Yes. |
| Install other people's apps into Æven in the first version? | No, own apps first. |
| Include the Dock or Start menu launcher in the first "Add to my computer"? | Own window first, launcher right after. |
| May a published app call the model for visitors? | Not until the backend phase, then capped and billed to the owner. |
| Run app server code on Cloudflare Workers for Platforms, with a D1 database per app? | Yes, as the full-stack tier after static sharing; see [Full-stack apps](#full-stack-apps). It revisits "no custom server per app" without long-lived processes. |

## Not yet verified

- **The nginx rules.** Written from nginx's documented behavior, not tested on pink.
- **Account folder names.** Assumed to be `users.userId`.
- **Public Suffix List requirements** for listing a whole domain like `aeven.app`.
- **Google's blocklist API** pricing and terms for commercial use.
- **Cloudflare's illegal-image scanning tool** being available on the current plan.
- **Cloudflare custom-hostname pricing.**
- **macOS signing** for generated launcher apps under Æven's signing setup.
- **Microsoft Store rules** on creating Start menu shortcuts for sub-apps.
- **Hosted Host browser cookies.** Only the API's cookies were checked.
- **Shared browser storage.** All of one user's apps share storage at `<username>.aeven.app`. An app-per-subdomain layout would isolate them and was not chosen.
- **Workers for Platforms and D1:** pricing, and the limits on Workers and databases per account.
- **The jail's preview port:** whether the hosted jail can expose a dev server's port to a preview proxy without widening its network rules.
- **The research in Full-stack apps** comes from documentation, packages and exported projects, not from building on those platforms; some of it is inferred from headers and DNS.

## Alternatives considered

- **Move files into `public/` on Share and move them back on Unshare.** Rejected: the served folders are read-only to the agent, so a moved artifact could no longer be edited; chat file cards and Show in Files would point at files that left; and Unshare would need a record of where each item came from. Copying costs disk for the built output only.
- **Ask for approval once per conversation and target folder.** Rejected: after the first approval a tricked agent could add private files to that folder with no card.
- **Strict email match for People you choose.** Not chosen: accounts made with Apple's hidden email or through X have no matching address. The one-time invite link covers them, and the owner sees which account accepted.
- **A one-time email code for viewers without an account.** Rejected: it is a second sign-in method to build and secure. Invited people need an Æven account.
- **Encrypted "Only me" and "Anyone with the link" links from the Apps plan.** Rejected: see the first row of Open decisions.
- **`<username>.public.aeven.io` or `<username>-public.aeven.io` addresses.** Rejected: see Why `aeven.app`.
- **A standalone native app per artifact.** Rejected: see Installable from the browser.
- **A custom server per app.** Rejected: see Built-in backend.
- **One subdomain per app.** Not chosen: see the last item of Not yet verified.

## Acceptance criteria

- Each of the five end goals in the End goals check can be done by a regular user in the phase that table names.
- A site shared as Public loads at `<username>.aeven.app/<name>/`, with its assets served from cache.
- After Unshare, the next request for the address gets the "This isn't shared." page, for all three Share options.
- The agent cannot place a file in `public/`, `links/` or `shared/` without an approval that listed that file.
- No file is served before the scanner released it.
- The hostile cases in Phase 1 (a served folder replaced by a link, links inside it, dotfiles, FIFOs) return 404 on pink.
- The Artifacts page lists the same artifacts on every device of an account, including those made before the page shipped.

## Risks

- **One abusive site can get all of `aeven.app` flagged** until the Public Suffix List entry lands; publishing is limited to accounts with credit until then.
- **The nginx rules, the scanner's release mechanism and the caching split are untested on pink.**
- **Shared items are readable by the server.** The plan gives up the Apps plan's promise that the server cannot read shared files.
- **Copies that left cannot be recalled:** downloaded files, offline copies in installed apps, and preview cards other sites fetched.
- **Open security designs:** visitors paying with their own Æven balance on a page the owner controls, and a checkout backend that acts on the owner's Stripe connection unattended. Neither may be built before its own design.
- **Usernames:** an address assigned from a name exposes that name, non-Latin names need a fallback, and a rename breaks links and browser installs.
- **The artifact index depends on account sync** being live on every device, and needs stable ids so two devices backfilling one conversation do not create duplicates.
