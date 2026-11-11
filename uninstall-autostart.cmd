@echo off
rem Stops the notes server from starting at login, and stops it now.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Notes server.lnk" 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:6683 .*LISTENING"') do taskkill /pid %%p /f >nul
echo Removed. The notes server no longer starts at login.
