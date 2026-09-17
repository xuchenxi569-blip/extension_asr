@echo off
cd /d "%~dp0"
title 本机转写服务
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败。窗口先留着，方便对照上面的报错。
  pause
)
