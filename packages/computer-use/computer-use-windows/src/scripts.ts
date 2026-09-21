/**
 * PowerShell source fragments the Windows adapter sends.
 *
 * Every fragment writes exactly one JSON object to stdout and nothing else, so a
 * caller parses a single line instead of scraping console output. Failures are
 * reported as `{ ok: false, error }` with a non-zero exit code rather than as an
 * exception whose text has to be pattern-matched.
 *
 * UI Automation is the primary mechanism because it needs **no permission
 * grant** on Windows and exposes real semantic patterns (`ValuePattern`,
 * `InvokePattern`), so most work never synthesises input at all.
 *
 * @module @aeven/computer-use-windows/scripts
 */

/** Emit exactly one JSON object and exit with a status. Shared with the
 * adapter's own synthesized fragments so every call answers in one shape. */
export const JSON_EMITTER = `
function Write-Json($value) { [Console]::Out.Write(($value | ConvertTo-Json -Depth 12 -Compress)) }
function Fail($message) { Write-Json @{ ok = $false; error = $message }; exit 1 }
`

/**
 * Load the UI Automation assemblies.
 *
 * Two namespaces matter: `UIAutomationClient` for the tree and patterns, and
 * `UIAutomationTypes` for the identifiers used to ask for them.
 */
const LOAD_UIA = `
try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop }
catch { Fail "UI Automation assemblies are unavailable: $($_.Exception.Message)" }
`

/**
 * List top-level windows with their owning process.
 *
 * `AutomationElement.RootElement` is the desktop, so its children are the
 * top-level windows. `ProcessId` is read from the element rather than inferred,
 * so the pid returned is the window's real owner.
 */
export const LIST_WINDOWS = `${JSON_EMITTER}${LOAD_UIA}
$items = New-Object System.Collections.ArrayList
foreach ($w in [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)) {
  $rect = $w.Current.BoundingRectangle
  [void]$items.Add(@{
    windowId = [string]$w.Current.NativeWindowHandle
    pid = [int]$w.Current.ProcessId
    title = [string]$w.Current.Name
    bounds = @{ x = [double]$rect.X; y = [double]$rect.Y; width = [double]$rect.Width; height = [double]$rect.Height }
  })
}
Write-Json @{ ok = $true; windows = $items }`

/**
 * Walk one window's accessibility subtree.
 *
 * The walk is breadth-first with an explicit cap, because a large document can
 * expose tens of thousands of nodes and an uncapped walk is indistinguishable
 * from a hang. Stopping early sets `truncated`, so a caller never mistakes a cut
 * tree for a complete one.
 *
 * @param nativeWindowHandleExpr - PowerShell expression yielding the window handle.
 * @param maxNodesExpr - PowerShell expression yielding the node cap.
 * @returns the PowerShell fragment.
 */
export function windowTreeScript(nativeWindowHandleExpr: string, maxNodesExpr: string): string {
  return `${JSON_EMITTER}${LOAD_UIA}
$handle = [IntPtr]${nativeWindowHandleExpr}
$max = [int]${maxNodesExpr}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { Fail "no window for handle $handle" }
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$nodes = New-Object System.Collections.ArrayList
$truncated = $false
$index = 0
while ($queue.Count -gt 0) {
  if ($nodes.Count -ge $max) { $truncated = $true; break }
  $element = $queue.Dequeue()
  $rect = $element.Current.BoundingRectangle
  [void]$nodes.Add(@{
    index = $index
    role = [string]$element.Current.ControlType.ProgrammaticName
    title = [string]$element.Current.Name
    value = $element.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty)
    actions = @(
      $element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }
    )
    editable = [bool]$element.Current.IsEnabled -and $element.Current.IsKeyboardFocusable
    bounds = @{ x = [double]$rect.X; y = [double]$rect.Y; width = [double]$rect.Width; height = [double]$rect.Height }
  })
  $index++
  $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($child in $children) { $queue.Enqueue($child) }
}
Write-Json @{ ok = $true; nodes = $nodes; truncated = $truncated }`
}

/**
 * Resolve one node by its stable ordinal path within the window.
 *
 * The snapshot token is the node's **index in the breadth-first walk**, and this
 * fragment replays that same walk to the same ordinal. That is deliberately the
 * same traversal the snapshot used: resolving by index into a differently
 * ordered walk would silently address a different control.
 * @param nativeWindowHandleExpr - PowerShell expression yielding the window handle.
 * @param tokenExpr - PowerShell expression yielding the node's ordinal index.
 * @returns the PowerShell fragment that emits the resolved element's identity.
 */
export function resolveNodeScript(nativeWindowHandleExpr: string, tokenExpr: string): string {
  return `${JSON_EMITTER}${LOAD_UIA}
$handle = [IntPtr]${nativeWindowHandleExpr}
$wanted = [int]${tokenExpr}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { Fail "no window for handle $handle" }
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$index = 0
$target = $null
while ($queue.Count -gt 0) {
  $element = $queue.Dequeue()
  if ($index -eq $wanted) { $target = $element; break }
  $index++
  foreach ($child in $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    $queue.Enqueue($child)
  }
}
if ($null -eq $target) { Fail "no element at index $wanted" }
Write-Json @{ ok = $true; role = [string]$target.Current.ControlType.ProgrammaticName; name = [string]$target.Current.Name }`
}

/**
 * Write a value through `ValuePattern`.
 *
 * Preferred over synthesised typing because it needs no focus, cannot be
 * delivered to the wrong window, and works on a backgrounded application.
 * @param nativeWindowHandleExpr - PowerShell expression yielding the window handle.
 * @param tokenExpr - PowerShell expression yielding the node's ordinal index.
 * @param valueExpr - PowerShell expression yielding the text to write.
 * @returns the PowerShell fragment.
 */
export function setValueScript(nativeWindowHandleExpr: string, tokenExpr: string, valueExpr: string): string {
  return `${JSON_EMITTER}${LOAD_UIA}
$handle = [IntPtr]${nativeWindowHandleExpr}
$wanted = [int]${tokenExpr}
$value = ${valueExpr}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { Fail "no window for handle $handle" }
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$index = 0
$target = $null
while ($queue.Count -gt 0) {
  $element = $queue.Dequeue()
  if ($index -eq $wanted) { $target = $element; break }
  $index++
  foreach ($child in $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    $queue.Enqueue($child)
  }
}
if ($null -eq $target) { Fail "no element at index $wanted" }
$pattern = $null
if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
  Fail "the element does not support ValuePattern; it is not a value-bearing control"
}
$pattern.SetValue($value)
Write-Json @{ ok = $true; wrote = $value.Length }`
}

/**
 * Invoke a semantic pattern the element advertises.
 *
 * The wanted pattern arrives as a `ValuePatternIdentifiers`-style programmatic
 * name, which is how `GetSupportedPatterns()` reports it, so a caller can pass
 * back exactly what the snapshot advertised instead of translating between two
 * vocabularies.
 * @param nativeWindowHandleExpr - PowerShell expression yielding the window handle.
 * @param tokenExpr - PowerShell expression yielding the node's ordinal index.
 * @param patternExpr - PowerShell expression yielding the pattern's programmatic name.
 * @returns the PowerShell fragment.
 */
export function performActionScript(nativeWindowHandleExpr: string, tokenExpr: string, patternExpr: string): string {
  return `${JSON_EMITTER}${LOAD_UIA}
$handle = [IntPtr]${nativeWindowHandleExpr}
$wanted = [int]${tokenExpr}
$wantedPattern = ${patternExpr}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { Fail "no window for handle $handle" }
$queue = New-Object System.Collections.Queue
$queue.Enqueue($root)
$index = 0
$target = $null
while ($queue.Count -gt 0) {
  $element = $queue.Dequeue()
  if ($index -eq $wanted) { $target = $element; break }
  $index++
  foreach ($child in $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    $queue.Enqueue($child)
  }
}
if ($null -eq $target) { Fail "no element at index $wanted" }
$advertised = @($target.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
if ($advertised -notcontains $wantedPattern) {
  Fail "the element does not advertise '$wantedPattern'; it advertises: $($advertised -join ', ')"
}
$pattern = $null
switch ($wantedPattern) {
  'InvokePatternIdentifiers.Pattern' {
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { Fail "InvokePattern could not be obtained" }
    $pattern.Invoke()
  }
  'TogglePatternIdentifiers.Pattern' {
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { Fail "TogglePattern could not be obtained" }
    $pattern.Toggle()
  }
  'ExpandCollapsePatternIdentifiers.Pattern' {
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) { Fail "ExpandCollapsePattern could not be obtained" }
    $pattern.Expand()
  }
  'SelectionItemPatternIdentifiers.Pattern' {
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { Fail "SelectionItemPattern could not be obtained" }
    $pattern.Select()
  }
  default { Fail "no invocation is defined for '$wantedPattern'" }
}
Write-Json @{ ok = $true; invoked = $wantedPattern }`
}

/**
 * Focus a window by handle.
 *
 * `SetForegroundWindow` is best-effort by design on Windows: the shell refuses it
 * for a process that does not own the foreground, so the fragment reports what
 * actually happened instead of assuming success.
 * @param nativeWindowHandleExpr - PowerShell expression yielding the window handle.
 * @returns the PowerShell fragment.
 */
export function focusWindowScript(nativeWindowHandleExpr: string): string {
  return `${JSON_EMITTER}
Add-Type -Namespace Aeven -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@
$handle = [IntPtr]${nativeWindowHandleExpr}
$requested = [Aeven.Win32]::SetForegroundWindow($handle)
$actual = [Aeven.Win32]::GetForegroundWindow()
Write-Json @{ ok = $true; requested = $requested; foregrounded = ($actual -eq $handle) }`
}

/**
 * Probe whether UI Automation can read the desktop.
 *
 * UIA needs no permission grant on Windows, so this is a real availability check
 * rather than a consent check: it fails only when the assemblies are missing or
 * the desktop is not reachable, which is what a headless session looks like.
 * @param maxNodesExpr - PowerShell expression yielding a small node cap for the probe.
 * @returns the PowerShell fragment.
 */
export function probeUiaScript(maxNodesExpr: string): string {
  return `${JSON_EMITTER}${LOAD_UIA}
try {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  Write-Json @{ ok = $true; windows = $windows.Count; cap = [int]${maxNodesExpr} }
} catch { Fail "UI Automation could not read the desktop: $($_.Exception.Message)" }`
}
