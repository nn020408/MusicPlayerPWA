# Registers a Windows scheduled task that keeps nubeplayer-artists.json up to
# date: it runs when you sign in and then every 30 minutes, in the background
# with no window. Each run only reads new or changed songs, so it takes a few
# seconds and doesn't touch the file (or make OneDrive upload it) unless
# something changed.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-artists-task.ps1 "E:\OneDrive\Music"
#
# Remove it again with:  Unregister-ScheduledTask -TaskName NubePlayerArtists -Confirm:$false

param([Parameter(Mandatory = $true)][string]$MusicFolder)

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot "scan-artists.js"
$launcher = Join-Path $PSScriptRoot "run-artists-scan.vbs"
$log = Join-Path $PSScriptRoot "artists-scan.log"

# wscript runs it with no console window flashing up every 30 minutes.
$vbs = @"
CreateObject("WScript.Shell").Run "cmd /c """"$node"" ""$script"" ""$MusicFolder"" >> ""$log"" 2>&1""", 0, False
"@
Set-Content -Path $launcher -Value $vbs -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcher`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$every30 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName "NubePlayerArtists" -Action $action -Trigger @($atLogon, $every30) -Settings $settings -Description "Keeps NubePlayer's artists file up to date" -Force | Out-Null
Start-ScheduledTask -TaskName "NubePlayerArtists"
Write-Host "Installed. Runs at sign-in and every 30 minutes. Log: $log"
