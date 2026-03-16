@echo off
TITLE AMR Control Center - Dev Mode
echo Starting AMR Control Center...
cd /d "%~dp0desktop_app"
npm run electron:dev
pause
