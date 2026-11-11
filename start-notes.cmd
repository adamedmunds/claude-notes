@echo off
rem Opens the notes site. Starts the server in the background first if it isn't running.
netstat -ano | findstr /r /c:":6683 .*LISTENING" >nul || (
  wscript "%~dp0notes-server.vbs"
  timeout /t 2 /nobreak >nul
)
start "" http://notes.localhost:6683
