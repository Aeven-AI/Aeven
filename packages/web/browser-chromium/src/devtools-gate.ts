/**
 * Send gate for the Chrome DevTools MCP tools that drive the Host's Chromium.
 *
 * chrome-devtools-mcp addresses elements by snapshot uid and pages by number,
 * and holds both maps inside its own process. This gate rebuilds the part it
 * needs from the tool results it observes: each snapshot line's uid, role, and
 * label under the page address of its `RootWebArea`, and each page list's
 * numbers, addresses, and selected page. A call whose target or page it has
 * not observed is treated as an unknown website and asks.
 *
 * @module @aeven/browser-chromium/devtools-gate
 */

import { isSendControl, isSendKey, isSendScript, pageSite, sendApproval, type PageSite, type SendApproval } from './send-gate.ts'

/** Most snapshot elements remembered; the oldest are forgotten first. */
const MAX_TARGETS = 20_000

/** One snapshot element as chrome-devtools-mcp printed it. */
interface Target {
  readonly role: string
  readonly label: string
  /** Address of the page the snapshot was taken on, when the snapshot named it. */
  readonly url: string | undefined
}

/** `uid=<id> <role> "<label>" <attributes>` — one snapshot line. */
const SNAPSHOT_LINE = /^\s*uid=(\S+) (\S+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/

/** `<n>: <title> (<url>) [selected]` — one page-list line. */
const PAGE_LINE = /^(\d+): .*\(([^()\s]+)\)(\s*\[selected\])?\s*$/

/** Watches chrome-devtools-mcp results and asks before its send-like calls on a website. */
export class DevtoolsSendGate {
  private readonly targets = new Map<string, Target>()
  private readonly pages = new Map<number, string>()
  private selected: number | undefined

  /**
   * Record the snapshot elements and pages a tool result printed.
   * @param text - the result's text blocks, joined.
   * @param pageId - the page the call named; a snapshot without one is of the selected page.
   */
  observe(text: string, pageId: number | undefined): void {
    let url: string | undefined
    for (const line of text.split('\n')) {
      const page = PAGE_LINE.exec(line)
      if (page !== null) {
        const id = Number(page[1])
        this.pages.set(id, page[2] ?? '')
        if (page[3] !== undefined) this.selected = id
        continue
      }
      const node = SNAPSHOT_LINE.exec(line)
      if (node === null) continue
      const [, uid = '', role = '', rawLabel = '', rest = ''] = node
      if (role === 'RootWebArea') {
        url = /\burl="([^"]*)"/.exec(rest)?.[1]
        const snapshotPage = pageId ?? this.selected
        if (url !== undefined && snapshotPage !== undefined) this.pages.set(snapshotPage, url)
      }
      this.targets.delete(uid)
      this.targets.set(uid, { role, label: rawLabel.replace(/\\(.)/g, '$1'), url })
      if (this.targets.size > MAX_TARGETS) {
        const oldest = this.targets.keys().next().value
        if (oldest !== undefined) this.targets.delete(oldest)
      }
    }
  }

  /**
   * Decide whether one chrome-devtools-mcp call needs the person's approval.
   * @param tool - the server's own tool name, such as `click`.
   * @param args - the call's arguments.
   * @returns the approval to ask for, or undefined when the call may run.
   */
  decide(tool: string, args: Record<string, unknown>): SendApproval | undefined {
    const page = (): PageSite => pageSite(this.pages.get(typeof args.pageId === 'number' ? args.pageId : this.selected ?? -1))
    const ask = (site: PageSite, action: string) => site.kind === 'local' ? undefined : sendApproval(site, action)
    switch (tool) {
      case 'click': {
        const target = typeof args.uid === 'string' ? this.targets.get(args.uid) : undefined
        if (target === undefined) return ask(page(), 'Click an element')
        return isSendControl(target.role, target.label) ? ask(pageSite(target.url), `Click "${target.label}"`) : undefined
      }
      case 'click_at':
        return ask(page(), 'Click a point on the page')
      case 'press_key':
        return typeof args.key === 'string' && isSendKey(args.key) ? ask(page(), `Press ${args.key}`) : undefined
      case 'type_text': {
        const submits = typeof args.submitKey === 'string' && isSendKey(args.submitKey)
        const breaks = typeof args.text === 'string' && args.text.includes('\n')
        return submits || breaks ? ask(page(), submits ? `Type text and press ${String(args.submitKey)}` : 'Type text with line breaks') : undefined
      }
      case 'evaluate_script':
        return typeof args.function === 'string' && isSendScript(args.function) ? ask(page(), 'Run a script that clicks or submits in the page') : undefined
      default:
        return undefined
    }
  }
}
