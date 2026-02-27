Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.SpecialFolders("Desktop") & "\Meeting Recorder.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "G:\Code\hidock-next\apps\meeting-recorder\run-meeting-recorder.bat"
oLink.WorkingDirectory = "G:\Code\hidock-next\apps\meeting-recorder"
oLink.Description = "HiDock Meeting Recorder - AI-Powered Transcription"
oLink.Save
WScript.Echo "Desktop shortcut created successfully!"
