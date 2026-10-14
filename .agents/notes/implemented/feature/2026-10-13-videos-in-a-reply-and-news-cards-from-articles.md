# Agent Note: Videos in a reply, and news cards from chosen articles

Status: implemented

English | [中文](2026-10-13-videos-in-a-reply-and-news-cards-from-articles.zh.md)

## Problem

A request such as "show me how a good bench press is done" was answered with prose, or at best with a YouTube link the reader had to leave the conversation to watch. Nothing in the reply could play a video.

The news cards added the day before rendered, but a live "latest tech news" run showed four defects. Cards arrived in Vietnamese and Bulgarian although the call named English: every request and the translation shared one 20-second deadline, the search and downloads spent it, and the translation was cancelled and silently kept the source text. Accented text showed raw entities (`Truy&ecirc;̀n`), because the decoder knew 13 named references. The model made one search per story with a count of three, so one story appeared three times in three languages, and the cards were search hits rather than the articles the reply was about. Sibling calls ran one after another because the tool never opted into parallel dispatch, so the turn took four and a half minutes.

A row of images or videos also split in two while a reply streamed: a blank line closed the streaming block at the last paragraph break, so a picture arriving after a pause started a new block and a new row.

## Decision

**Videos play in place.** The Markdown engine turns every YouTube or Vimeo link into a player. A paragraph that holds only video links becomes the players themselves, and a run of them forms one `div.markdown-video-grid` that the host tiles like a row of images: one video spans the column, two share it, three take thirds. A video mentioned inside a sentence keeps its link, and a player follows the paragraph that mentions it. Each player shows the provider's poster under a play button and loads the provider's frame only when pressed, so a reply listing several videos, and every transcript replayed later, loads stills rather than players. The frame address is rebuilt from the video's id (YouTube from `youtube-nocookie.com`, Vimeo with `dnt=1`) and never taken from the link. Tiles carry a 30px corner.

Every tile is 3:2, poster and player alike, so a row reads as one band and nothing moves when a video starts; a video of another shape plays letterboxed inside it. Vimeo's poster comes from its oEmbed lookup, and YouTube's from the id. Until its poster loads, a tile shows the same loading surface an image tile does.

The `aeven` preset tells the model to search for a video and link it on its own line when the person asks to be shown how something is done or moves, and to link only videos a search returned.

The desktop app gives the YouTube player's document request a web referrer, because YouTube refuses to play (error 153) for the `avn-app://` page.

**Streaming keeps a media run open.** When the paragraph before a blank line is an image or video line, the block stays open until the next paragraph shows whether the run continues, so a run renders as one row however the stream is paced.

**News cards come from the articles the model chose.** `find_images` takes `urls` with layout `cards`: one card per article, in the order the reply presents them, made by fetching each page in parallel. The preset tells the model to make one such call per answer and not to list the stories again as links. Every request has its own deadline and the translation its own `translationTimeoutMs`. Text is decoded with the `entities` package and cut at a sentence or whole word. Opening text skips photo credits and follow prompts. The tool declares itself safe to run beside sibling calls. The client reads the layout from the parsed arguments.

## Alternatives considered

**Crop a playing video to fill its tile, as `object-fit: cover` would.** Built and rejected in the live check: a cross-origin player can only be cropped by enlarging its frame, which pushes YouTube's control bar out of view for any video of another shape.

**Reshape a playing tile to the video's own aspect ratio.** Built and rejected in the live check: the tile grows when the reader presses play, which reads as the page jumping.

**Load each provider's player at once instead of a poster.** One heavyweight player per video on every render and replay, and each one reports the view to the provider before the reader chooses to watch.

**Leave a video linked inside prose as a link.** That is what "show me how" must not produce; the link stays for the sentence, and the player is added beside it.

**Regroup rows after the stream ends.** The renderer keeps settled blocks rather than re-rendering the document, and re-rendering would remount any player the reader already started.

## Consequences

A reply can answer "show me how" with a video the reader watches in place. Any YouTube or Vimeo link a reply contains now plays, including citations; a reply that cites many videos shows many posters.

The desktop referrer is set in the main process and was verified only in the web client.

The prompt and `find_images` changes take effect on the next Host start. `find_images` still has no test suite, and a card's opening text is scraped with patterns rather than a readability parser.
