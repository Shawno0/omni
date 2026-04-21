@echo off
setlocal
set ROOT_DIR=%~dp0..\..\..\..
set VSROOT_DIR=%~dp0..\..
start "Open Browser" /B "%ROOT_DIR%\node.exe" "%VSROOT_DIR%\out\server-cli.js" "code-server" "1.116.0" "be537ce77a2d84428ad834890d2f6f1e413366ad" "code-server.cmd" "--openExternal" "%*"
endlocal
