# PowerShell script to create a Desktop shortcut for HiDock Meeting Intelligence (Dev Mode)
# Run this script once to create the shortcut

$WshShell = New-Object -ComObject WScript.Shell

# Get paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$BatchFile = Join-Path $ProjectRoot "run-electron.bat"
$IconPath = Join-Path $ScriptDir "resources\icon.png"

# Create Desktop shortcut
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "HiDock Meeting Intelligence (Dev).lnk"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatchFile
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "HiDock Meeting Intelligence - Development Mode"
$Shortcut.WindowStyle = 7  # Minimized
$Shortcut.Save()

Write-Host "Desktop shortcut created at: $ShortcutPath" -ForegroundColor Green

# Create Start Menu shortcut
$StartMenuPath = [Environment]::GetFolderPath("StartMenu")
$StartMenuProgramsPath = Join-Path $StartMenuPath "Programs"
$StartMenuShortcutPath = Join-Path $StartMenuProgramsPath "HiDock Meeting Intelligence (Dev).lnk"

$StartMenuShortcut = $WshShell.CreateShortcut($StartMenuShortcutPath)
$StartMenuShortcut.TargetPath = $BatchFile
$StartMenuShortcut.WorkingDirectory = $ScriptDir
$StartMenuShortcut.Description = "HiDock Meeting Intelligence - Development Mode"
$StartMenuShortcut.WindowStyle = 7  # Minimized
$StartMenuShortcut.Save()

Write-Host "Start Menu shortcut created at: $StartMenuShortcutPath" -ForegroundColor Green

Write-Host ""
Write-Host "Done! You can now launch HiDock Meeting Intelligence (Dev) from:" -ForegroundColor Cyan
Write-Host "  - Desktop" -ForegroundColor Cyan
Write-Host "  - Start Menu (search for 'HiDock')" -ForegroundColor Cyan
