@echo off
setlocal
set ROOT_DIR=%~dp0..\..\..\..
set VSROOT_DIR=%~dp0..\..
start "Open Browser" /B "%ROOT_DIR%\node.exe" "%VSROOT_DIR%\out\server-cli.js" "code-server" "1.109.2" "9184b645cc7aa41b750e2f2ef956f2896512dd84" "code-server.cmd" "--openExternal" "%*"
endlocal
