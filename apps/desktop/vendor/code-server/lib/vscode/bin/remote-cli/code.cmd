@echo off
setlocal
set ROOT_DIR=%~dp0..\..\..\..
set VSROOT_DIR=%~dp0..\..
call "%ROOT_DIR%\node.exe" "%VSROOT_DIR%\out\server-cli.js" "code-server" "1.108.2" "3c0b449c6e6e37b44a8a7938c0d8a3049926a64c" "code-server.cmd" %*
endlocal
