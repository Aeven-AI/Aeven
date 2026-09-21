/**
 * Listing windows on macOS.
 *
 * Windows are read through `System Events`, which is the accessibility rung
 * expressed in AppleScript and needs the Automation grant for System Events
 * rather than the Accessibility grant. That is a deliberate choice: it means a
 * plain window list works before AX is permitted, so a caller can find its target
 * window and only then needs the deeper grant to read its contents.
 *
 * @module @aeven/computer-use-macos/windows
 */

import { ComputerUseError, type DesktopWindow } from '@aeven/computer-use-desktop'

/** One process as the listing reports it. */
interface RawProcess {
  pid: number
  name: string
  windows: Array<{ name: string, position: string, size: string }>
}

/**
 * AppleScript that emits every window of every process as one JSON object.
 *
 * `background only` processes are skipped: they cannot own a window a user sees,
 * and including them would make the list mostly noise. Positions and sizes come
 * as AppleScript `list` values, which `as text` renders as a comma-separated
 * pair, because System Events does not hand back JSON-friendly numbers.
 * @returns the AppleScript source.
 */
export function listWindowsScript(): string {
  return `
tell application "System Events"
  set rows to {}
  repeat with proc in (every process whose background only is false)
    try
      set procName to name of proc
      set procPid to unix id of proc
      repeat with win in (every window of proc)
        try
          set winName to ""
          try
            set winName to name of win
          end try
          set winPos to "0, 0"
          set winSize to "0, 0"
          try
            set winPos to (position of win) as text
          end try
          try
            set winSize to (size of win) as text
          end try
          set end of rows to "{\\"pid\\":" & procPid & ",\\"app\\":\\"" & my escape(procName) & "\\",\\"title\\":\\"" & my escape(winName) & "\\",\\"position\\":\\"" & winPos & "\\",\\"size\\":\\"" & winSize & "\\"}"
        end try
      end repeat
    end try
  end repeat
  return "[" & my join(rows, ",") & "]"
end tell

on escape(value)
  set out to ""
  repeat with i from 1 to (count of characters of value)
    set c to character i of value
    if c is "\\"" then
      set out to out & "\\\\\\""
    else if c is "\\\\" then
      set out to out & "\\\\\\\\"
    else
      set out to out & c
    end if
  end repeat
  return out
end escape

on join(theList, delimiter)
  set out to ""
  repeat with i from 1 to (count of theList)
    if i > 1 then set out to out & delimiter
    set out to out & (item i of theList)
  end repeat
  return out
end join
`
}

/** One window row as the script emits it. */
interface RawWindowRow {
  pid: number
  app: string
  title: string
  position: string
  size: string
}

/**
 * Parse a `position`/`size` pair rendered by AppleScript as "x, y".
 * @param text - the rendered pair.
 * @returns the two numbers, defaulting to zero when unreadable.
 */
export function parsePair(text: string): { a: number, b: number } {
  const [first, second] = text.split(',').map(part => Number(part.trim()))
  return {
    a: Number.isFinite(first) ? (first as number) : 0,
    b: Number.isFinite(second) ? (second as number) : 0,
  }
}

/**
 * Parse the listing into windows.
 * @param stdout - the script's captured output.
 * @returns the windows, in the order the script reported them.
 * @throws {ComputerUseError} `capability-unavailable` when the output is unreadable.
 */
export function parseWindowList(stdout: string): DesktopWindow[] {
  const line = stdout.trim().split('\n').filter(entry => entry.trim().length > 0).at(-1)
  if (line === undefined) {
    throw new ComputerUseError('capability-unavailable', 'listing windows produced no output')
  }
  let rows: RawWindowRow[]
  try {
    rows = JSON.parse(line) as RawWindowRow[]
  } catch {
    throw new ComputerUseError('capability-unavailable', 'the window listing was not JSON', { output: line.slice(0, 200) })
  }
  return rows.map((row) => {
    const position = parsePair(row.position)
    const size = parsePair(row.size)
    return {
      // System Events exposes no stable window id, so the title and owning pid
      // together are the identity; the adapter matches by title within a process.
      windowId: `${row.title}`,
      pid: row.pid,
      app: { id: row.app, displayName: row.app },
      title: row.title,
      bounds: { x: position.a, y: position.b, width: size.a, height: size.b },
      onScreen: size.a > 0 && size.b > 0,
    }
  })
}

/**
 * Whether the listing reports a process that can own windows.
 *
 * Exported for tests and for callers that want to filter a listing themselves
 * without re-implementing the rule.
 * @param raw - one process row.
 * @returns true when it reports at least one window.
 */
export function hasWindows(raw: RawProcess): boolean {
  return raw.windows.length > 0
}
