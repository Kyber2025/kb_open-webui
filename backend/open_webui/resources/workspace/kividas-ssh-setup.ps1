param([string]$ConnectionFile, [switch]$PickConnectionFile)
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host '  KIVIDAS  /  SSH WORKSPACE' -ForegroundColor Magenta
Write-Host '  配置一次，以后输入 claude 即可连接'
Write-Host '  ────────────────────────────────────────────' -ForegroundColor DarkGray
function Step($Number, $Text) { Write-Host "`n  [$Number/4]  $Text" -ForegroundColor Cyan }
Step 1 '导入个人连接 TXT'
if (-not $ConnectionFile -and $PickConnectionFile) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $Dialog = New-Object System.Windows.Forms.OpenFileDialog
    try {
        $Dialog.Title = '选择从 Kividas 下载的个人连接 TXT'
        $Dialog.Filter = 'Kividas 连接资料 (*.txt)|*.txt'
        $Dialog.CheckFileExists = $true
        $Dialog.Multiselect = $false
        $Downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
        if (Test-Path -LiteralPath $Downloads) { $Dialog.InitialDirectory = $Downloads }
        if ($Dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host '  已取消，未更改本机配置。'; return }
        $ConnectionFile = $Dialog.FileName
    } finally { $Dialog.Dispose() }
}
if (-not $ConnectionFile) { $ConnectionFile = (Read-Host '  拖入个人连接 TXT，按回车').Trim().Trim('"').Trim("'") }
if (-not (Test-Path -LiteralPath $ConnectionFile -PathType Leaf)) { throw '找不到个人连接 TXT。' }
$Item = Get-Item -LiteralPath $ConnectionFile -Force
if ($Item.Length -gt 8192 -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '无效的 TXT 文件。' }
$Fields = @{}
foreach ($Line in [IO.File]::ReadAllLines($Item.FullName)) {
    if (-not $Line -or $Line.StartsWith('#')) { continue }
    # Use the PowerShell operator: .NET Framework on Windows 5.1 resolves
    # String.Split(..., 2) as StringSplitOptions rather than a substring count.
    $Pair = $Line -split '=', 2
    if ($Pair.Count -ne 2 -or $Fields.ContainsKey($Pair[0]) -or $Pair[0] -cnotmatch '^(KIVIDAS_SSH_CONFIG|SSH_NAME|SSH_URL|SSH_FINGERPRINT|SSH_PASSWORD|SSH_DIRECTORY)$') { throw 'TXT 格式错误，请重新下载。' }
    $Fields[$Pair[0]] = $Pair[1]
}
if ($Fields.KIVIDAS_SSH_CONFIG -cne '1' -or $Fields.SSH_NAME -cnotmatch '^ssh[0-9]{2}$' -or $Fields.SSH_DIRECTORY -cne '/workspace/claude') { throw 'TXT 版本或工作区无效。' }
if ($Fields.SSH_URL -cnotmatch '^ssh://(ws_[a-f0-9]{16})@([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):([0-9]{1,5})$') { throw 'SSH URL 无效。' }
$WorkspaceName = $Fields.SSH_NAME
$WorkspaceUser = $Matches[1]; $WorkspaceHost = $Matches[2]; $WorkspacePort = $Matches[3]
if (@($WorkspaceHost.Split('.') | Where-Object { [int]$_ -gt 255 }).Count -or [int]$WorkspacePort -lt 1 -or [int]$WorkspacePort -gt 65535) { throw 'SSH 地址或端口无效。' }
$ExpectedFingerprint = $Fields.SSH_FINGERPRINT
if ($ExpectedFingerprint -cnotmatch '^SHA256:[A-Za-z0-9+/]{43}$' -or $Fields.SSH_PASSWORD -cnotmatch '^[A-Za-z0-9_-]{32}$') { throw '指纹或密码无效。' }
Write-Host "  已选择 $WorkspaceName · ${WorkspaceHost}:$WorkspacePort"
Step 2 '验证实例指纹与连接'
$ClientHome = if ($env:KIVIDAS_CLIENT_HOME) { $env:KIVIDAS_CLIENT_HOME } else { [Environment]::GetFolderPath('UserProfile') }
$Root = Join-Path $ClientHome '.kividas'
$Base = Join-Path $Root "ssh\$WorkspaceName-$WorkspaceUser"
$Bin = Join-Path $Root 'bin'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($Command in @('ssh.exe', 'sftp.exe', 'ssh-keygen.exe', 'ssh-keyscan.exe')) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Missing $Command. Install the Windows OpenSSH Client optional feature first."
    }
}
$ErrorActionPreference = 'Continue'
$SshVersion = (& ssh.exe -V 2>&1 | Out-String)
$ErrorActionPreference = 'Stop'
if ($SshVersion -notmatch 'OpenSSH(?:_for_Windows)?_(\d+)\.(\d+)' -or [int]$Matches[1] -lt 8 -or ([int]$Matches[1] -eq 8 -and [int]$Matches[2] -lt 6)) {
    throw '需要 OpenSSH 8.6 或更新版本。请更新 Windows OpenSSH 客户端后重试。'
}
foreach ($Directory in @($Root, (Join-Path $Root 'ssh'), $Base, $Bin)) {
    if ((Test-Path -LiteralPath $Directory) -and ((Get-Item -LiteralPath $Directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a linked installation directory.'
    }
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
}
# Only the current Windows user can read the private key directory.
$Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$Acl = New-Object System.Security.AccessControl.DirectorySecurity
$Acl.SetOwner($Sid)
$Acl.SetAccessRuleProtection($true, $false)
$Rule = New-Object System.Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$Acl.AddAccessRule($Rule)
Set-Acl -LiteralPath $Base -AclObject $Acl
$Key = Join-Path $Base 'id_ed25519'
$Known = Join-Path $Base 'known_hosts'
$Config = Join-Path $Base 'config'
foreach ($File in @($Key, "$Key.pub", $Known, $Config, (Join-Path $Base 'launch.ps1'))) {
    if ((Test-Path -LiteralPath $File) -and ((Get-Item -LiteralPath $File -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a linked configuration file.'
    }
}
$Scan = Join-Path $Base ('.host-key-' + [Guid]::NewGuid().ToString('N'))
try {
    # Native stderr contains OpenSSH version banners, even when scanning succeeds.
    $ErrorActionPreference = 'Continue'
    $Scanned = & ssh-keyscan.exe -T 10 -p $WorkspacePort -t ed25519 $WorkspaceHost 2>$null
    $ScanExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($ScanExit -ne 0 -or -not $Scanned) { throw 'Cannot read the workspace host key.' }
    [IO.File]::WriteAllLines($Scan, [string[]]$Scanned, $Utf8)
    $Fingerprint = & ssh-keygen.exe -lf $Scan -E sha256
    if ($LASTEXITCODE -ne 0 -or @($Fingerprint).Count -ne 1 -or (($Fingerprint -split '\s+')[1] -cne $ExpectedFingerprint)) {
        throw 'Server fingerprint mismatch. Setup stopped.'
    }
    Move-Item -LiteralPath $Scan -Destination $Known -Force
} finally {
    if (Test-Path -LiteralPath $Scan) { Remove-Item -LiteralPath $Scan -Force }
}
if (-not (Test-Path -LiteralPath $Key)) {
    # Windows PowerShell 5.1 needs an explicitly quoted empty native argument.
    $EmptyPassphrase = if ($PSVersionTable.PSVersion.Major -lt 7) { '""' } else { '' }
    & ssh-keygen.exe -q -t ed25519 -N $EmptyPassphrase -C kividas-workspace-client -f $Key
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the device key.' }
}
$KeyAcl = New-Object System.Security.AccessControl.FileSecurity
$KeyAcl.SetOwner($Sid)
$KeyAcl.SetAccessRuleProtection($true, $false)
$KeyAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'Allow')))
Set-Acl -LiteralPath $Key -AclObject $KeyAcl
$PublicLines = @(& ssh-keygen.exe -y -f $Key)
if ($LASTEXITCODE -ne 0 -or $PublicLines.Count -ne 1) { throw 'Could not read the device public key.' }
# Some OpenSSH versions retain the comment; only the validated key fields are sent.
$PublicParts = $PublicLines[0] -split '\s+'
if ($PublicParts.Count -lt 2 -or $PublicParts[0] -cne 'ssh-ed25519' -or $PublicParts[1] -notmatch '^[A-Za-z0-9+/=]+$') { throw 'Could not read the device public key.' }
$PublicKey = $PublicParts[0] + ' ' + $PublicParts[1]
[IO.File]::WriteAllText("$Key.pub", $PublicKey + "`n", $Utf8)
$ConfigBase = $Base.Replace('\', '/').Replace('%', '%%').Replace('"', '\"')
[IO.File]::WriteAllText($Config, @"
Host workspace
  HostName $WorkspaceHost
  Port $WorkspacePort
  User $WorkspaceUser
  IdentityFile "$ConfigBase/id_ed25519"
  UserKnownHostsFile "$ConfigBase/known_hosts"
  GlobalKnownHostsFile NUL
  StrictHostKeyChecking yes
  HostKeyAlgorithms ssh-ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 10
  ConnectTimeout 15
  ForwardAgent no
  ClearAllForwardings yes
"@ + "`n", $Utf8)
Step 3 '配置本机免密密钥'
$ErrorActionPreference = 'Continue'
& ssh.exe -F $Config -o BatchMode=yes workspace true 2>$null
$Enrolled = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $Enrolled) {
    # A local .NET helper supplies the TXT password only to OpenSSH. It is never
    # passed on the command line. Its directory inherits the current-user-only ACL.
    $SecretDir = Join-Path $Base ('.enroll-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($SecretDir) | Out-Null
    $PreviousEnv = @{}
    foreach ($Name in @('SSH_ASKPASS','SSH_ASKPASS_REQUIRE','DISPLAY')) { $PreviousEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
    try {
        [IO.File]::WriteAllText((Join-Path $SecretDir 'password'), $Fields.SSH_PASSWORD, $Utf8)
        $Source = 'using System; using System.IO; class AskPass { static void Main() { Console.WriteLine(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "password"))); } }'
        $Cs = Join-Path $SecretDir 'AskPass.cs'; $Exe = Join-Path $SecretDir 'AskPass.exe'
        [IO.File]::WriteAllText($Cs, $Source, $Utf8)
        $Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
        if (-not (Test-Path -LiteralPath $Compiler)) { $Compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
        if (-not (Test-Path -LiteralPath $Compiler)) { throw '缺少 Windows .NET Framework，请安装后重试。' }
        & $Compiler /nologo /target:exe "/out:$Exe" $Cs
        if ($LASTEXITCODE -ne 0) { throw '无法创建本机登录助手。' }
        $env:SSH_ASKPASS = $Exe; $env:SSH_ASKPASS_REQUIRE = 'force'; $env:DISPLAY = 'kividas-setup:0'
    # The validated public key is not a credential secret. No shell metacharacters are allowed.
    $Enroll = 'set -eu; cd /workspace/claude; umask 077; test ! -L .ssh; mkdir -p .ssh; test ! -L .ssh/authorized_keys; touch .ssh/authorized_keys; chmod 700 .ssh; chmod 600 .ssh/authorized_keys; grep -qxF -- ''restrict,pty ' + $PublicKey + ''' .ssh/authorized_keys || echo ''restrict,pty ' + $PublicKey + ''' >> .ssh/authorized_keys'
    & ssh.exe -F $Config -o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 workspace $Enroll
    if ($LASTEXITCODE -ne 0) { throw '登录失败。订阅到期或绑定变更后请重新下载 TXT。' }
    } finally {
        foreach ($Name in $PreviousEnv.Keys) { [Environment]::SetEnvironmentVariable($Name, $PreviousEnv[$Name], 'Process') }
        Remove-Item -LiteralPath $SecretDir -Recurse -Force
    }
}
$Fields.Remove('SSH_PASSWORD')
& ssh.exe -F $Config -o BatchMode=yes workspace true
if ($LASTEXITCODE -ne 0) { throw 'Key sign-in failed. Shortcuts were not installed.' }
Step 4 '安装 claude / SSH / SFTP 快捷命令'
$Launcher = @'
$ErrorActionPreference = 'Stop'
$Mode = if ($args.Count) { $args[0] } else { 'claude' }
$RemoteArguments = @($args | Select-Object -Skip 1)
$Config = Join-Path $PSScriptRoot 'config'
switch ($Mode) {
    'shell' { & ssh.exe -F $Config -o BatchMode=yes -t workspace @RemoteArguments }
    'sftp' { & sftp.exe -F $Config -o BatchMode=yes @RemoteArguments workspace }
    'claude' {
        # Base64 JSON preserves spaces, quotes, Unicode and shell characters on Windows 5.1 and 7.
        $Argv = @('/usr/local/bin/workspace-session', 'claude') + $RemoteArguments
        $Json = ConvertTo-Json -InputObject $Argv -Compress
        $Encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json))
        $Remote = "cd /workspace/claude && exec python3 -c 'import os,sys,json,base64; a=json.loads(base64.b64decode(sys.argv[1])); os.execvp(a[0],a)' $Encoded"
        $Tty = if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { '-T' } else { '-t' }
        & ssh.exe -F $Config -o BatchMode=yes $Tty workspace $Remote
    }
    default { throw 'Unknown launch mode.' }
}
exit $LASTEXITCODE
'@
# Windows PowerShell requires a BOM to read a Unicode user path reliably.
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
[IO.File]::WriteAllText((Join-Path $Base 'launch.ps1'), $Launcher, $Utf8Bom)
$Modes = @{ 'claude' = 'claude'; 'claude-ssh' = 'shell'; 'claude-sftp' = 'sftp' }
foreach ($Name in $Modes.Keys) {
    $Shortcut = Join-Path $Bin ($Name + '.cmd')
    if (Test-Path -LiteralPath $Shortcut) {
        $Existing = [IO.File]::ReadAllText($Shortcut)
        if (-not $Existing.Contains('REM KIVIDAS WORKSPACE LAUNCHER')) { throw "Will not replace an unmanaged shortcut: $Shortcut" }
    }
    # Resolve the script relative to this .cmd so Unicode Windows profile names are safe.
    $Relative = '..\ssh\' + $WorkspaceName + '-' + $WorkspaceUser + '\launch.ps1'
    $Batch = '@echo off' + "`r`n" + 'REM KIVIDAS WORKSPACE LAUNCHER' + "`r`n" + '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0' + $Relative + '" ' + $Modes[$Name] + ' %*' + "`r`n"
    [IO.File]::WriteAllText($Shortcut, $Batch, [Text.Encoding]::ASCII)
}
$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$Parts = @($UserPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $Bin.TrimEnd('\') })
[Environment]::SetEnvironmentVariable('Path', (@($Bin) + $Parts) -join ';', 'User')
Write-Host "`n  ✓ 配置完成。打开新终端，输入 claude 即可使用。" -ForegroundColor Green
Write-Host 'Shell: claude-ssh    Files: claude-sftp'
Write-Host 'Claude now runs on the remote workspace. Removing the user binding revokes this key.'
Write-Host ('If this terminal still has the old PATH, launch directly: & "' + (Join-Path $Bin 'claude.cmd') + '"')

Write-Host '个人 TXT 含 SSH 密码，请妥善保存。到期自动解绑并清空文件，请提前备份。' -ForegroundColor DarkYellow
