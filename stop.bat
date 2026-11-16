@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -Command "$f='.jarhop/server.pid'; if(Test-Path -LiteralPath $f){$runPid=[int](Get-Content -LiteralPath $f); $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$runPid); $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4789 -State Listen -ErrorAction SilentlyContinue; if($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.mjs' -and $listener.OwningProcess -eq $runPid){Stop-Process -Id $runPid}}"
