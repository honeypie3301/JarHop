@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul || (echo Install Node.js 22 or newer. & exit /b 1)
if not exist node_modules call npm.cmd ci || exit /b 1
call npm.cmd run build || exit /b 1
call npm.cmd test
