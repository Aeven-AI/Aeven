@echo off
setlocal DisableDelayedExpansion
set "signTool=%AVN_DESKTOP_WINDOWS_SIGNTOOL%"
set "certificateFile=%AVN_DESKTOP_WINDOWS_CER_FILE%"
set "tokenPin=%AVN_DESKTOP_WINDOWS_TOKEN_PIN%"
set "keyContainer=%AVN_DESKTOP_WINDOWS_KEY_CONTAINER%"
set "targetFile=%AVN_DESKTOP_WINDOWS_SIGN_TARGET%"
set "appendSignature="
if "%AVN_DESKTOP_WINDOWS_SIGN_APPEND%"=="1" set "appendSignature=/as"
set "AVN_DESKTOP_WINDOWS_SIGNTOOL="
set "AVN_DESKTOP_WINDOWS_CER_FILE="
set "AVN_DESKTOP_WINDOWS_TOKEN_PIN="
set "AVN_DESKTOP_WINDOWS_KEY_CONTAINER="
set "AVN_DESKTOP_WINDOWS_SIGN_TARGET="
set "AVN_DESKTOP_WINDOWS_SIGN_APPEND="
set "signTool=" & set "certificateFile=" & set "tokenPin=" & set "keyContainer=" & set "targetFile=" & set "appendSignature=" & "%signTool%" sign /v /fd sha256 /f "%certificateFile%" /kc "[{{%tokenPin%}}]=%keyContainer%" /csp "eToken Base Cryptographic Provider" %appendSignature% /tr http://timestamp.digicert.com /td sha256 "%targetFile%"
exit /b %errorlevel%
