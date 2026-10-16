; electron-builder's per-machine default is $PROGRAMFILES unless the build defines APP_64,
; which only an x64 build does, so an arm64-only installer lands in "Program Files (x86)".
; The shell then rewrites a shortcut's icon path from there to "%ProgramFiles%", which names
; a different (or missing) executable, and the shortcut loses the Aeven icon. The template
; prefers a recorded InstallLocation over its default, so recording the 64-bit directory
; before it reads one moves both new installs and earlier "(x86)" installs; a location
; anywhere else was chosen by the user and stays.
!macro preInit
  !ifdef APP_ARM64
    !ifndef APP_64
      Push $0
      ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 == ""
      ${OrIf} $0 == "$PROGRAMFILES32\${APP_FILENAME}"
        WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\${APP_FILENAME}"
      ${EndIf}
      Pop $0
    !endif
  !endif
!macroend
