/**
 * The Chrome extension APIs this extension uses, declared for exactly the calls
 * it makes; the full `@types/chrome` surface is not a dependency.
 */
declare namespace chrome {
  export namespace runtime {
    interface MessageSender { tab?: tabs.Tab; origin?: string }
    interface Port {
      postMessage(message: unknown): void
      disconnect(): void
      readonly sender?: MessageSender
      readonly onMessage: { addListener(callback: (message: any) => void): void }
      readonly onDisconnect: { addListener(callback: () => void): void }
    }
    function sendMessage(message: unknown): Promise<unknown>
    const onMessage: { addListener(callback: (message: any, sender: MessageSender) => void): void }
    const onConnectExternal: { addListener(callback: (port: Port) => void): void }
    function connectNative(application: string): Port
    function getManifest(): { version: string }
    function getURL(path: string): string
    const lastError: { message?: string } | undefined
    const onStartup: { addListener(callback: () => void): void }
    const onInstalled: { addListener(callback: () => void): void }
  }
  export namespace tabs {
    interface Tab { id?: number; windowId: number; url?: string; title?: string; groupId: number }
    function create(properties: { url?: string; active?: boolean }): Promise<Tab>
    function get(tabId: number): Promise<Tab>
    function remove(tabId: number): Promise<void>
    function group(options: { tabIds: number | number[]; groupId?: number }): Promise<number>
    const onUpdated: { addListener(callback: (tabId: number, change: { url?: string; title?: string; status?: string }, tab: Tab) => void): void }
    const onRemoved: { addListener(callback: (tabId: number) => void): void }
  }
  export namespace tabGroups {
    interface TabGroup { id: number; title?: string; windowId: number }
    function query(query: { title?: string; windowId?: number }): Promise<TabGroup[]>
    function update(groupId: number, properties: { title?: string; color?: string; collapsed?: boolean }): Promise<TabGroup>
  }
  // `debugger` is a reserved word, so the namespace is declared under another name and exported as it.
  export namespace _debugger {
    interface Debuggee { tabId?: number }
    function attach(target: Debuggee, requiredVersion: string): Promise<void>
    function detach(target: Debuggee): Promise<void>
    function sendCommand(target: Debuggee, method: string, commandParams?: object): Promise<unknown>
    const onEvent: { addListener(callback: (source: Debuggee, method: string, params?: any) => void): void; removeListener(callback: (source: Debuggee, method: string, params?: any) => void): void }
    const onDetach: { addListener(callback: (source: Debuggee, reason: string) => void): void }
  }
  export { _debugger as debugger }
  export namespace history {
    interface HistoryItem { url?: string; title?: string; lastVisitTime?: number; visitCount?: number }
    function search(query: { text: string; startTime?: number; maxResults?: number }): Promise<HistoryItem[]>
  }
  export namespace bookmarks {
    interface BookmarkTreeNode { url?: string; title: string; dateAdded?: number }
    function search(query: string): Promise<BookmarkTreeNode[]>
    function getRecent(numberOfItems: number): Promise<BookmarkTreeNode[]>
  }
  export namespace storage {
    const session: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }
    const local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }
  }
  export namespace management {
    function getSelf(): Promise<{ installType: 'admin' | 'development' | 'normal' | 'sideload' | 'other' }>
  }
  export namespace alarms {
    function create(name: string, info: { periodInMinutes: number }): void
    const onAlarm: { addListener(callback: (alarm: { name: string }) => void): void }
  }
}
