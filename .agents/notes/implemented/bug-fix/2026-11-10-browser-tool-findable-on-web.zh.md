# Agent Note：浏览器工具可以被找到，并按它在 Aeven Web 上的实际作用来命名

Status: implemented

[English](2026-11-10-browser-tool-findable-on-web.md) | 中文

## 问题

2026-11-10 的托管会话 `c1b1a219` 中，用户分享了一个 ChatGPT 链接。`web_fetch` 只返回了登录页外壳，模型随后用 `tool_search` 搜索 “browser navigate screenshot page”。`preview_*` 工具其实已经加载，但 `tool_search` 只搜索延迟加载的工具，于是回答 “No deferred tool matches”，模型就告诉用户它无法读取该页面。直到用户说扩展已安装，它才调用 `preview_navigate`，通过 Aeven 扩展在用户的浏览器中打开并读取了页面。`preview_navigate` 的描述只提到桌面版会话旁边的浏览器，而 `web_fetch` 没有提示登录页需要用浏览器打开。

## 决策

- `tool_search`（`packages/core/tool-search/src/index.ts`）也会把查询与智能体已持有的工具进行匹配，并把匹配项列在 “Already loaded, call directly” 下，无论是没有延迟工具匹配时，还是与延迟工具的匹配一起列出。
- `preview_navigate`（`packages/web/tool-browser/src/index.ts`）说明：在桌面应用中它打开会话旁边的浏览器，在 Aeven Web 上则通过 Aeven 扩展在用户自己的浏览器中打开一个已登录的标签页，并且它能读取 `web_fetch` 读不到的页面。
- `web_fetch`（`packages/web/tool-web/src/fetch.ts`）说明它不携带登录状态，并在 `preview_navigate` 可用时指向它来处理这类页面。

扩展缺失时，`preview_navigate` 已经会让调用停在安装提示之后（`packages/client/ui-sidebar-browser/src/client/extension-install.ts`），因此用户看到的是这个提示，而不是拒绝。

## 考虑过的替代方案

在智能体提示中加入行为规则被否决：人设只承载语气，而工具描述才是模型选择工具的地方。

把 `preview_*` 工具改为延迟加载以便 `tool_search` 找到它们，会让每个浏览回合多一次加载往返。

## 影响

该描述对模型可见，在每个携带该工具的请求中多出两句话；记录的工具结构快照包含新文本。

## 验证

tool-search、tool-browser 和 tool-web 的测试通过（147 个）。重新构建后，无密钥的快照回放在记录了这些工具的所有场景中都通过；`assessment-memory` 和 `acp image-compaction` 因无关的提示漂移以及需要重新录制的脚本而失败，与 `main` 上相同。
