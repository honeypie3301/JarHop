@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul || (echo Install Node.js 22 or newer. & exit /b 1)
node setup-toolchain.mjs
exit /b %errorlevel%
