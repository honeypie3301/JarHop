@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\jszip call npm.cmd ci || exit /b 1
if not exist dist\index.html call npm.cmd run build:static || exit /b 1
start "" /b powershell -NoProfile -NonInteractive -Command "foreach($i in 1..30){try{Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4789/api/local' -TimeoutSec 1 | Out-Null; Start-Process 'http://127.0.0.1:4789'; break}catch{Start-Sleep -Milliseconds 400}}"
node server.mjs
