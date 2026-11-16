@echo off
setlocal
if "%~1"=="" (
    echo Usage: refresh.bat path-to-refresh-config.json
    exit /b 1
)
node "%~dp0refresh-cli.mjs" "%~f1"
exit /b %errorlevel%
