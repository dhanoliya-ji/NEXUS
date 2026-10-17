# ============================================================
#  install-backup.ps1 — run ONCE to back up NEXUS every day
# ============================================================
#  Creates a Windows scheduled task "NEXUS Backup" that runs
#  backup.py every day at 9 PM (and later if the laptop was off).
#
#  Run:  powershell -ExecutionPolicy Bypass -File D:\NEXUS\local\install-backup.ps1

$python = (Get-Command python).Source
$script = Join-Path $PSScriptRoot "backup.py"

$action   = New-ScheduledTaskAction -Execute $python -Argument "`"$script`""
$trigger  = New-ScheduledTaskTrigger -Daily -At 9pm
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask -TaskName "NEXUS Backup" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "Done! NEXUS will back up to D:\NEXUS\backup every day."
