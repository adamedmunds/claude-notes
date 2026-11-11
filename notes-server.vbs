' Starts the notes server in the background with no window.
' Used by the Windows Startup shortcut and by start-notes.cmd.
' Output goes to notes-server.log in this folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c node server.js > notes-server.log 2>&1", 0, False
