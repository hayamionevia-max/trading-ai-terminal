@echo off
setlocal

cd /d D:\★チャートとAI

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":8001 .*LISTENING"') do (
    echo Port 8001 is already listening. PID=%%P
    echo.
    netstat -ano | findstr :8001
    goto :eof
)

echo Starting API server on port 8001...
start "FX Chart API 8001" cmd /k "cd /d D:\★チャートとAI && python api\index.py"

timeout /t 2 /nobreak >nul
echo.
echo Port 8001 status:
netstat -ano | findstr :8001

endlocal
