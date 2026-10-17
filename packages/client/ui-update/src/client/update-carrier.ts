/** What the Desktop shell's preload exposes for its release stream. */

/**
 * One release-stream state, as the shell publishes it. The phases that name a
 * release always carry its version.
 */
export type DesktopUpdateStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'checking' }
  | {
    readonly phase: 'available' | 'downloading' | 'ready' | 'installing'
    readonly version: string
    /** Download progress, 0 through 100, while `downloading`. */
    readonly percent?: number
  }
  | {
    readonly phase: 'error'
    /** Release the failure was about, when one was known. */
    readonly version?: string
    /** Failure text. */
    readonly message?: string
  }

/** The release stream the shell owns and the popup drives and follows. */
export interface DesktopUpdateCarrier {
  /** @returns the state the shell last published. */
  get(): Promise<DesktopUpdateStatus>
  /** @returns the state the check it started reached. */
  check(): Promise<DesktopUpdateStatus>
  /** Installs the downloaded release and restarts the application. */
  install(): Promise<void>
  /**
   * @param listener - called with each state the shell publishes.
   * @returns disposer removing the listener.
   */
  onChange(listener: (status: DesktopUpdateStatus) => void): () => void
}

/** Application-menu commands this plugin answers. */
export const SHOW_UPDATE_COMMAND = 'show-update'

/**
 * The update carrier, or undefined where no Desktop shell renders the page.
 * @param scope - the page's global object, whose preload carrier is optional.
 * @returns the release stream the shell exposes, when there is one.
 */
export function desktopUpdateCarrier(
  scope: { avnDesktop?: { update?: DesktopUpdateCarrier } },
): DesktopUpdateCarrier | undefined {
  return scope.avnDesktop?.update
}
