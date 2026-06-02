@echo off
title [Trading AI Ultimate Tuning Pipeline]
cd /d "%~dp0.."

echo ========================================================
echo   TRADING AI ULTIMATE TUNE START
echo ========================================================
echo.

echo -^> [Phase 1] Distilling 65+ Core Knowledge Files using Local Giant Model (llava)...
"venv\Scripts\python.exe" "src\teacher_pipeline.py" "raw_data"
if errorlevel 1 (
    echo [ERROR] Distillation failed.
    pause
    exit /b 1
)
echo -^> [Phase 1 SUCCESS] All files distilled beautifully!
echo.

echo -^> [Phase 2] Launching 300-Epoch Deep Pretraining...
"venv\Scripts\python.exe" "src\train.py" --epochs 300 --lr 1e-4
if errorlevel 1 (
    echo [ERROR] Deep training failed.
    pause
    exit /b 1
)
echo -^> [Phase 2 SUCCESS] Deep training completed!
echo.

echo -^> [Phase 3] Exporting and deploying ONNX weights...
"venv\Scripts\python.exe" "src\export.py"
if errorlevel 1 (
    echo [ERROR] ONNX export failed.
    pause
    exit /b 1
)
echo -^> [Phase 3 SUCCESS] ONNX model successfully updated and deployed!
echo.

echo ========================================================
echo   ALL PIPELINES COMPLETED SUCCESSFULLY!
echo ========================================================
pause
