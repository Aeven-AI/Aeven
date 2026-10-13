/** One MemOS core per account, each over its own database, opened on the account's first memory operation. */
import type { MemoryCore } from '@deepseek-ai/memos-local-plugin/agent-contract/memory-core.js'

/** Lazily opened MemOS cores keyed by owning account. */
export class OwnerCores {
  private readonly cores = new Map<string, Promise<MemoryCore>>()
  private closed = false

  /**
   * @param open - bootstraps and initializes the core of one account; called at most once per account
   * while its previous open has not failed.
   */
  constructor(private readonly open: (owner: string) => Promise<MemoryCore>) {}

  /**
   * The account's core, opening it on first use. Concurrent first uses share one open, and a failed
   * open is forgotten so the next operation retries it.
   * @param owner - account id of the signed-in user.
   * @returns the account's initialized core.
   */
  get(owner: string): Promise<MemoryCore> {
    if (this.closed) return Promise.reject(new Error('memory-memos: the provider is shutting down'))
    let core = this.cores.get(owner)
    if (core === undefined) {
      const opening = this.open(owner)
      core = opening
      this.cores.set(owner, opening)
      opening.catch(() => {
        if (this.cores.get(owner) === opening) this.cores.delete(owner)
      })
    }
    return core
  }

  /**
   * Refuse further opens and shut down every core that opened.
   * @returns after every opened core shut down.
   */
  async shutdown(): Promise<void> {
    this.closed = true
    const opened = [...this.cores.values()]
    this.cores.clear()
    await Promise.all(opened.map(async (opening) => {
      const core = await opening.catch(() => undefined)
      await core?.shutdown()
    }))
  }
}
