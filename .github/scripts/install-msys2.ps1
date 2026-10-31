# Install the MSYS2 toolchain a Windows build needs, tolerating a slow mirror.
#
# `msys2/setup-msys2`'s own `update` runs `pacman -Syuu` once, and one transfer slower than a byte per second
# then fails the whole build with `failed to synchronize all databases`. This script keeps that upgrade but
# hands every transfer to curl with its own retries, then repeats the sync and install a few times.
#
# Usage: install-msys2.ps1 -Msys2Root <setup action's msys2-location output> -Packages make,nasm,...

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $Msys2Root,
  [Parameter(Mandatory = $true)][string[]] $Packages
)

$ErrorActionPreference = 'Stop'

$pacman = Join-Path $Msys2Root 'usr/bin/pacman.exe'
$config = Join-Path $Msys2Root 'etc/pacman.conf'
if (-not (Test-Path $pacman)) { throw "install-msys2: no pacman at $pacman" }

# pacman aborts a transfer that stalls; curl retries the same file instead of failing the mirror sync.
$transfer = 'XferCommand = /usr/bin/curl -L -C - -f -o %o %u --retry 10 --retry-delay 5 --retry-all-errors --connect-timeout 20'
if (-not (Select-String -Path $config -Pattern '^XferCommand' -Quiet)) {
  Add-Content -Path $config -Value $transfer
}

for ($attempt = 1; $attempt -le 4; $attempt++) {
  & $pacman -Syuu --needed --noconfirm
  if ($LASTEXITCODE -eq 0) {
    & $pacman -S --needed --noconfirm @Packages
    if ($LASTEXITCODE -eq 0) { exit 0 }
  }
  Write-Host "install-msys2: attempt $attempt failed; retrying after $($attempt * 20)s"
  Start-Sleep -Seconds ($attempt * 20)
}

throw "install-msys2: pacman did not finish installing $($Packages -join ' ')"
