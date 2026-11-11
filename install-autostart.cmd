@echo off
rem Makes the notes server start (hidden) when you log in to Windows, and starts it now.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Notes server.lnk');" ^
  "$s.TargetPath = \"$env:WINDIR\System32\wscript.exe\";" ^
  "$s.Arguments = '\"%~dp0notes-server.vbs\"';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.Description = 'Starts the local notes site (http://notes.localhost:6683)';" ^
  "$s.Save()"
wscript "%~dp0notes-server.vbs"
echo Installed. The notes server now starts when you log in, and is running now.
echo Open http://notes.localhost:6683
