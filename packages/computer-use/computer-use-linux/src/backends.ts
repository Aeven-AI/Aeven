/**
 * Window backends for Linux.
 *
 * Window control is the fragmented part of the Linux desktop: on Wayland each
 * compositor exposes its own control surface, and X11 offers EWMH. Rather than
 * pretend these are one thing, each backend is a small declaration — how to list
 * windows, how to focus one — and the adapter tries them **in order** and reports
 * which one answered. A desktop with none of them is a named blocker, not an
 * empty window list.
 *
 * @module @aeven/computer-use-linux/backends
 */

/** One window as a backend reports it. */
export interface BackendWindow {
  windowId: string
  pid: number
  title: string
  bounds: { x: number, y: number, width: number, height: number }
}

/** What a backend can do. */
export interface WindowBackend {
  /** Stable backend name, reported in readiness and in observations. */
  name: string
  /** Executable the backend needs. */
  command: string
  /** Arguments that list windows and emit JSON. */
  listArgs: readonly string[]
  /**
   * Parse the backend's own listing format.
   * @param stdout - the command's captured output.
   * @returns the windows it reported.
   */
  parse(stdout: string): BackendWindow[]
  /**
   * Arguments that focus one window.
   * @param windowId - the backend's own window identifier.
   * @returns the command arguments.
   */
  focusArgs(windowId: string): readonly string[]
}

/** A rectangle as Hyprland reports it. */
interface HyprClient {
  address: string
  pid: number
  title: string
  at: [number, number]
  size: [number, number]
}

/** Hyprland exposes a JSON client list over `hyprctl`. */
const HYPRLAND: WindowBackend = {
  name: 'hyprland',
  command: 'hyprctl',
  listArgs: ['clients', '-j'],
  parse: (stdout) => {
    const clients = JSON.parse(stdout) as HyprClient[]
    return clients.map(client => ({
      windowId: client.address,
      pid: client.pid,
      title: client.title,
      bounds: { x: client.at[0], y: client.at[1], width: client.size[0], height: client.size[1] },
    }))
  },
  focusArgs: windowId => ['dispatch', 'focuswindow', `address:${windowId}`],
}

/** One node of the i3/sway tree. */
interface I3Node {
  id: number
  pid?: number
  name?: string
  window?: number
  rect: { x: number, y: number, width: number, height: number }
  nodes: I3Node[]
  floating_nodes: I3Node[]
}

/**
 * Flatten an i3 tree into the windows that carry an X11 window id.
 * @param node - the subtree to walk.
 * @param out - accumulator for the windows found.
 * @returns the accumulator.
 */
function flattenI3(node: I3Node, out: BackendWindow[] = []): BackendWindow[] {
  if (node.window !== undefined) {
    out.push({
      windowId: String(node.window),
      pid: node.pid ?? 0,
      title: node.name ?? '',
      bounds: node.rect,
    })
  }
  for (const child of [...node.nodes, ...node.floating_nodes]) {
    flattenI3(child, out)
  }
  return out
}

/** i3 and sway answer over their IPC socket via `i3-msg`. */
const I3: WindowBackend = {
  name: 'i3',
  command: 'i3-msg',
  listArgs: ['-t', 'get_tree'],
  parse: (stdout) => flattenI3(JSON.parse(stdout) as I3Node),
  focusArgs: windowId => [`[id=${windowId}]`, 'focus'],
}

/**
 * Parse `wmctrl -lGp` output.
 *
 * Columns are: window id, desktop, pid, x, y, width, height, host, title. The
 * title is last and may contain spaces, so it is taken as the remainder.
 * @param stdout - the command's captured output.
 * @returns the windows it reported.
 */
function parseWmctrl(stdout: string): BackendWindow[] {
  const windows: BackendWindow[] = []
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 9) {
      continue
    }
    const [windowId, , pid, x, y, width, height] = fields as [string, string, string, string, string, string, string]
    windows.push({
      windowId,
      pid: Number(pid),
      title: fields.slice(8).join(' '),
      bounds: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
    })
  }
  return windows
}

/** Generic X11 and EWMH compositors answer through `wmctrl`. */
const EWMH: WindowBackend = {
  name: 'ewmh',
  command: 'wmctrl',
  listArgs: ['-lGp'],
  parse: parseWmctrl,
  focusArgs: windowId => ['-i', '-a', windowId],
}

/**
 * Every backend, in the order they are tried.
 *
 * Compositor-specific backends come first because they carry richer data, and
 * EWMH comes last because it is the widest but least detailed. The order is data,
 * not control flow, so a caller can see and test exactly what will be tried.
 */
export const WINDOW_BACKENDS: readonly WindowBackend[] = [HYPRLAND, I3, EWMH]
