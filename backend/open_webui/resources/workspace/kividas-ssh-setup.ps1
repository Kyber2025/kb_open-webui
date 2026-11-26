param([string]$ConnectionFile, [switch]$PickConnectionFile, [switch]$Launch)
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
foreach ($Command in @('ssh.exe', 'sftp.exe', 'ssh-keygen.exe')) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Missing $Command. Install the Windows OpenSSH Client optional feature first."
    }
}
$SshExecutable = (Get-Command ssh.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
function ConvertTo-WorkspaceProcessArgument([string]$Value) {
    # ProcessStartInfo.Arguments uses Windows CRT quoting on both PS 5.1 and 7.
    # Quote every argument, doubling backslashes before quotes and the closing quote.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-WorkspaceSetupProcess {
    param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 30)
    $Info = New-Object Diagnostics.ProcessStartInfo
    $Info.FileName = $FilePath
    $Info.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WorkspaceProcessArgument $_ }) -join ' ')
    $Info.WorkingDirectory = (Get-Location).ProviderPath
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardInput = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    $Process = New-Object Diagnostics.Process
    $Process.StartInfo = $Info
    $Started = $false
    try {
        $Started = $Process.Start()
        if (-not $Started) { throw '无法启动本机配置程序。' }
        # Do not inherit console handles: a short, silent Win32 OpenSSH command
        # can otherwise finish on the server but remain blocked on console input.
        $Process.StandardInput.Close()
        $OutputTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrorTask = $Process.StandardError.ReadToEndAsync()
        $Watch = [Diagnostics.Stopwatch]::StartNew()
        $NextProgress = 5
        while (-not $Process.WaitForExit(250)) {
            if ($Watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
                throw "当前步骤超过 $TimeoutSeconds 秒，已停止等待。可以关闭窗口后重试，已有密钥会保留。"
            }
            if ($Watch.Elapsed.TotalSeconds -ge $NextProgress) {
                Write-Host ("  正在等待响应… {0}s / {1}s" -f [int]$Watch.Elapsed.TotalSeconds, $TimeoutSeconds) -ForegroundColor DarkGray
                $NextProgress += 5
            }
        }
        if (-not $OutputTask.Wait(1000) -or -not $ErrorTask.Wait(1000)) { throw '本机 SSH 进程输出未正常关闭，已停止配置。请关闭窗口后重试。' }
        return [pscustomobject]@{ ExitCode = $Process.ExitCode; Output = $OutputTask.Result; Error = $ErrorTask.Result }
    } finally {
        if ($Started -and -not $Process.HasExited) { $Process.Kill(); $null = $Process.WaitForExit(2000) }
        $Process.Dispose()
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
function Assert-WorkspaceOwner([string]$Path) {
    $Owner = (Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($Owner -notin @($Sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        throw 'Refusing a configuration file or directory owned by another user.'
    }
}
Assert-WorkspaceOwner $Base
$Acl = New-Object System.Security.AccessControl.DirectorySecurity
$Acl.SetAccessRuleProtection($true, $false)
$Rule = New-Object System.Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$Acl.AddAccessRule($Rule)
# Set-Acl copies the audit descriptor too, which can require SeSecurityPrivilege
# once inheritance is protected. Persist only the access rules via .NET; retain
# the verified owner so ordinary users never need WRITE_OWNER or audit privileges.
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [IO.Directory]::SetAccessControl($Base, $Acl)
} else {
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Base), $Acl)
}
$Key = Join-Path $Base 'id_ed25519'
$Known = Join-Path $Base 'known_hosts'
$Config = Join-Path $Base 'config'
foreach ($File in @($Key, "$Key.pub", $Known, $Config, (Join-Path $Base 'launch.ps1'), (Join-Path $Base 'transport.exe'), (Join-Path $Base 'transport.json'))) {
    if ((Test-Path -LiteralPath $File) -and ((Get-Item -LiteralPath $File -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a linked configuration file.'
    }
}
# BEGIN TRANSPORT HASHES
$TransportHashes = @{
    'windows-amd64' = 'f7e278aad12028110d48f7296ca56c026d339302bf152f0cf5c09a13670d4b04'
    'windows-arm64' = '8d65e649878086693d115cbe263308243b82373202b9f1d30cf53a7d89fba83b'
}
# END TRANSPORT HASHES
$Architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
if (-not [Environment]::Is64BitOperatingSystem) { throw '需要 64 位 Windows。' }
$TransportPlatform = 'windows-' + $Architecture
$Transport = Join-Path $Base 'transport.exe'
$TransportHash = $TransportHashes[$TransportPlatform]
if (-not (Test-Path -LiteralPath $Transport) -or (Get-FileHash -LiteralPath $Transport -Algorithm SHA256).Hash -ine $TransportHash) {
    Write-Host '  正在准备自动连接组件…' -ForegroundColor DarkGray
    $TemporaryTransport = Join-Path $Base ('.transport-' + [Guid]::NewGuid().ToString('N'))
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri ('https://chat.kividas.com/api/v1/code/ssh-workspaces/transport/v1/' + $TransportPlatform) -OutFile $TemporaryTransport -TimeoutSec 90 -MaximumRedirection 0
        if ((Get-FileHash -LiteralPath $TemporaryTransport -Algorithm SHA256).Hash -ine $TransportHash) { throw '连接组件校验失败，请重新下载配置文件。' }
        Move-Item -LiteralPath $TemporaryTransport -Destination $Transport -Force
    } finally { if (Test-Path -LiteralPath $TemporaryTransport) { Remove-Item -LiteralPath $TemporaryTransport -Force } }
}
$Digest = [Security.Cryptography.SHA256]::Create()
try { $RelayToken = ([BitConverter]::ToString($Digest.ComputeHash($Utf8.GetBytes("kividas-ssh-relay-v1`0" + $Fields.SSH_PASSWORD)))).Replace('-', '').ToLowerInvariant() }
finally { $Digest.Dispose() }
$TransportConfig = @{ address = "${WorkspaceHost}:$WorkspacePort"; username = $WorkspaceUser; token = $RelayToken } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $Base 'transport.json'), $TransportConfig, $Utf8)
$RelayToken = $null; $TransportConfig = $null
$ProxyCommand = '"' + $Transport.Replace('\', '/').Replace('%', '%%').Replace('"', '\"') + '"'
$Scan = Join-Path $Base ('.host-key-' + [Guid]::NewGuid().ToString('N'))
$ProbeConfig = $Scan + '.config'
$ProbeError = $Scan + '.error'
try {
    # Windows OpenSSH 9.2/9.5 ssh-keyscan advertises unsupported hybrid KEX.
    # Use the normal SSH client for an authentication-disabled handshake instead.
    # The temporary key is untrusted until its out-of-band TXT fingerprint matches;
    # no password, agent or device key is offered by this probe.
    $ProbeKnownPath = $Scan.Replace('\', '/').Replace('%', '%%').Replace('"', '\"')
    [IO.File]::WriteAllText($ProbeConfig, @"
Host workspace-probe
  HostName $WorkspaceHost
  ProxyCommand $ProxyCommand
  Port $WorkspacePort
  User $WorkspaceUser
  UserKnownHostsFile "$ProbeKnownPath"
  GlobalKnownHostsFile NUL
  StrictHostKeyChecking accept-new
  HostKeyAlgorithms ssh-ed25519
  UpdateHostKeys no
  BatchMode yes
  PreferredAuthentications none
  PubkeyAuthentication no
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  GSSAPIAuthentication no
  HostbasedAuthentication no
  IdentityAgent none
  ForwardAgent no
  ClearAllForwardings yes
  ConnectTimeout 25
  ConnectionAttempts 1
"@ + "`n", $Utf8)
    $Probe = Invoke-WorkspaceSetupProcess $SshExecutable @('-n','-T','-F',$ProbeConfig,'workspace-probe','true')
    # Authentication failure is expected; the host key was exchanged before it.
    if (-not (Test-Path -LiteralPath $Scan) -or (Get-Item -LiteralPath $Scan).Length -eq 0) {
        $Diagnostic = $Probe.Error
        $Reason = switch -Regex ($Diagnostic) {
            'timed out' { '连接超时'; break }
            'Connection refused' { '服务器拒绝连接'; break }
            'Connection reset|Connection closed' { '连接被中断'; break }
            'Network is unreachable|No route to host' { '网络不可达'; break }
            'no matching|unsupported|Bad configuration|Bad owner|Bad permissions' { 'SSH 客户端或本机配置不兼容'; break }
            default { '未收到服务器主机密钥' }
        }
        throw "无法连接 ${WorkspaceHost}:$WorkspacePort（$Reason）。直连及 HTTPS 备用入口均未完成连接，请检查网络后重试。"
    }
    $Fingerprint = & ssh-keygen.exe -lf $Scan -E sha256
    if ($LASTEXITCODE -ne 0 -or @($Fingerprint).Count -ne 1 -or (($Fingerprint -split '\s+')[1] -cne $ExpectedFingerprint)) {
        throw 'Server fingerprint mismatch. Setup stopped.'
    }
    Move-Item -LiteralPath $Scan -Destination $Known -Force
} finally {
    foreach ($Temporary in @($Scan, $ProbeConfig, $ProbeError)) {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force }
    }
}
if (-not (Test-Path -LiteralPath $Key)) {
    # Windows PowerShell 5.1 needs an explicitly quoted empty native argument.
    $EmptyPassphrase = if ($PSVersionTable.PSVersion.Major -lt 7) { '""' } else { '' }
    & ssh-keygen.exe -q -t ed25519 -N $EmptyPassphrase -C kividas-workspace-client -f $Key
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the device key.' }
}
Assert-WorkspaceOwner $Key
$KeyAcl = New-Object System.Security.AccessControl.FileSecurity
$KeyAcl.SetAccessRuleProtection($true, $false)
$KeyAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'Allow')))
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [IO.File]::SetAccessControl($Key, $KeyAcl)
} else {
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($Key), $KeyAcl)
}
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
  ProxyCommand $ProxyCommand
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
  ConnectTimeout 25
  ForwardAgent no
  ClearAllForwardings yes
"@ + "`n", $Utf8)
Step 3 '配置本机免密密钥'
# Setup connections are finite operations, separate from the interactive launcher.
# The fixed response verifies remote execution, rather than only authentication.
$SetupSshOptions = @('-n','-T','-F',$Config,'-o','IdentityAgent=none','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=3','-o','ConnectionAttempts=1')
$CheckOptions = @('-o','BatchMode=yes','-o','PreferredAuthentications=publickey','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no')
$CheckCommand = "printf 'KIVIDAS_KEY_OK\n'"
Write-Host '  3.1 检查已有免密连接（最多 30 秒）' -ForegroundColor DarkGray
$Check = Invoke-WorkspaceSetupProcess $SshExecutable ($SetupSshOptions + $CheckOptions + @('workspace',$CheckCommand))
$Enrolled = $Check.ExitCode -eq 0 -and $Check.Output.Trim() -ceq 'KIVIDAS_KEY_OK'
if (-not $Enrolled) {
    if ($Check.ExitCode -ne 255 -or $Check.Error -notmatch 'Permission denied') {
        throw '免密连接检查未完成。实例已通过指纹验证，但没有正常返回验证结果。请检查连接后重试。'
    }
    # A local .NET helper supplies the TXT password only to OpenSSH. It is never
    # passed on the command line. Its directory inherits the current-user-only ACL.
    Write-Host '  3.2 注册本机密钥' -ForegroundColor DarkGray
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
        $Compiled = Invoke-WorkspaceSetupProcess $Compiler @('/nologo','/target:exe',"/out:$Exe",$Cs)
        if ($Compiled.ExitCode -ne 0) { throw '无法创建本机登录助手。' }
        # Windows OpenSSH reads SSH_ASKPASS through a narrow-character environment API.
        # A relative ASCII path avoids corrupting Unicode profile names.
        $env:SSH_ASKPASS = '.\AskPass.exe'; $env:SSH_ASKPASS_REQUIRE = 'force'; $env:DISPLAY = 'kividas-setup:0'
        # The validated public key is not a credential secret. No shell metacharacters are allowed.
        $Enroll = 'set -eu; cd /workspace/claude; umask 077; test ! -L .ssh; mkdir -p .ssh; test ! -L .ssh/authorized_keys; touch .ssh/authorized_keys; chmod 700 .ssh; chmod 600 .ssh/authorized_keys; grep -qxF -- ''restrict,pty ' + $PublicKey + ''' .ssh/authorized_keys || echo ''restrict,pty ' + $PublicKey + ''' >> .ssh/authorized_keys; printf ''KIVIDAS_ENROLLED\n'''
        Push-Location -LiteralPath $SecretDir
        try {
            $Registered = Invoke-WorkspaceSetupProcess $SshExecutable ($SetupSshOptions + @('-o','PubkeyAuthentication=no','-o','PreferredAuthentications=password','-o','NumberOfPasswordPrompts=1','workspace',$Enroll))
            if ($Registered.ExitCode -ne 0 -or $Registered.Output.Trim() -cne 'KIVIDAS_ENROLLED') { throw '密钥注册失败。订阅到期或绑定变更后请重新下载 TXT。' }
        } finally { Pop-Location }
    } finally {
        foreach ($Name in $PreviousEnv.Keys) { [Environment]::SetEnvironmentVariable($Name, $PreviousEnv[$Name], 'Process') }
        Remove-Item -LiteralPath $SecretDir -Recurse -Force
    }
    Write-Host '  3.3 验证新密钥（最多 30 秒）' -ForegroundColor DarkGray
    $Check = Invoke-WorkspaceSetupProcess $SshExecutable ($SetupSshOptions + $CheckOptions + @('workspace',$CheckCommand))
    if ($Check.ExitCode -ne 0 -or $Check.Output.Trim() -cne 'KIVIDAS_KEY_OK') { throw '新密钥验证未完成。请重试配置，已有密钥会保留。' }
}
$Fields.Remove('SSH_PASSWORD')
Write-Host '  ✓ 免密连接已验证' -ForegroundColor Green
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
$env:Path = $Bin + ';' + $env:Path
$LauncherPath = Join-Path $Base 'launch.ps1'

# Profiles are read for each new PowerShell session, even when Windows Terminal
# passes down a stale PATH. Functions also take priority over a local Claude binary.
# Only configure this user's console profiles; preserve their other customizations.
$Documents = if ($env:KIVIDAS_CLIENT_HOME) { Join-Path $ClientHome 'Documents' } else { [Environment]::GetFolderPath('MyDocuments') }
$Desktop = if ($env:KIVIDAS_CLIENT_HOME) { Join-Path $ClientHome 'Desktop' } else { [Environment]::GetFolderPath('DesktopDirectory') }
$Begin = '# BEGIN KIVIDAS WORKSPACE'
$End = '# END KIVIDAS WORKSPACE'
$QuotedLauncher = $LauncherPath.Replace("'", "''")
$ProfileBlock = $Begin + "`r`n"
foreach ($Name in @('claude', 'claude-ssh', 'claude-sftp')) {
    $ProfileBlock += 'Remove-Item -LiteralPath Alias:\' + $Name + ' -Force -ErrorAction SilentlyContinue' + "`r`n"
    $ProfileBlock += 'function global:' + $Name + " { & '" + $QuotedLauncher + "' '" + $Modes[$Name] + "' @args }`r`n"
}
$ProfileBlock += $End + "`r`n"
$ProfilePattern = '(?ms)^# BEGIN KIVIDAS WORKSPACE\r?\n.*?^# END KIVIDAS WORKSPACE(?:\r?\n|$)'
$ProfileReady = $false
try {
    # Enable locally-created profiles only when no persistent policy was set.
    # Never relax an explicit user, machine or organization policy.
    $PersistentPolicies = @('MachinePolicy','UserPolicy','CurrentUser','LocalMachine' | ForEach-Object { Get-ExecutionPolicy -Scope $_ } | Where-Object { $_ -ne 'Undefined' })
    if (-not $PersistentPolicies.Count) {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue
        $PersistentPolicies = @(Get-ExecutionPolicy -Scope CurrentUser)
    }
    if ($PersistentPolicies[0] -notin @('RemoteSigned','Unrestricted','Bypass')) { throw '当前安全策略不允许自动加载 PowerShell 配置' }
    foreach ($Edition in @('WindowsPowerShell','PowerShell')) {
        $ProfileDirectory = Join-Path $Documents $Edition
        $ProfilePath = Join-Path $ProfileDirectory 'Microsoft.PowerShell_profile.ps1'
        [IO.Directory]::CreateDirectory($ProfileDirectory) | Out-Null
        $ExistingProfile = ''
        if (Test-Path -LiteralPath $ProfilePath) {
            if ((Get-Item -LiteralPath $ProfilePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PowerShell 配置文件是链接，未自动修改' }
            $ExistingProfile = [IO.File]::ReadAllText($ProfilePath)
            if ($ExistingProfile.Contains('# SIG # Begin signature block')) { throw 'PowerShell 配置文件有数字签名，未自动修改' }
            if (-not (Test-Path -LiteralPath ($ProfilePath + '.before-kividas'))) { Copy-Item -LiteralPath $ProfilePath -Destination ($ProfilePath + '.before-kividas') }
        }
        $WithoutManaged = [regex]::Replace($ExistingProfile, $ProfilePattern, '')
        if ($WithoutManaged.Contains($Begin) -or $WithoutManaged.Contains($End)) { throw 'PowerShell 配置中的快捷命令区块不完整' }
        $UpdatedProfile = $WithoutManaged.TrimEnd([char[]]"`r`n") + "`r`n" + $ProfileBlock
        $ParseTokens = $null; $ParseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseInput($UpdatedProfile, [ref]$ParseTokens, [ref]$ParseErrors)
        if ($ParseErrors.Count) { throw '现有 PowerShell 配置存在语法错误，未自动修改' }
        [IO.File]::WriteAllText($ProfilePath, $UpdatedProfile, $Utf8Bom)
    }
    $ProfileReady = $true
} catch {
    Write-Host ('  PowerShell 快捷命令未启用：' + $_.Exception.Message + '。可使用桌面 Claude SSH 入口。') -ForegroundColor DarkYellow
}

# The desktop entry and immediate launch never depend on command lookup or PATH.
try {
    [IO.Directory]::CreateDirectory($Desktop) | Out-Null
    $ShortcutPath = Join-Path $Desktop 'Claude SSH.lnk'
    # Use the Unicode ShellLink interface: WScript.Shell can corrupt non-ANSI
    # user/desktop paths when saving shortcuts.
    if (-not ('KividasWorkspaceShortcut' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
class KividasShellLink {}
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IKividasShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr data, uint flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetHotkey(out short value);
    void SetHotkey(short value);
    void GetShowCmd(out int value);
    void SetShowCmd(int value);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}
public static class KividasWorkspaceShortcut {
    public static string[] Read(string path) {
        var link = (IKividasShellLinkW)new KividasShellLink();
        try {
            ((IPersistFile)link).Load(path, 0);
            var description = new StringBuilder(32768); var arguments = new StringBuilder(32768);
            link.GetDescription(description, description.Capacity); link.GetArguments(arguments, arguments.Capacity);
            return new string[] { description.ToString(), arguments.ToString() };
        } finally { Marshal.ReleaseComObject(link); }
    }
    public static void Save(string path, string target, string arguments, string directory, string description) {
        if (File.Exists(path) && !Read(path)[0].StartsWith("Kividas SSH workspace:", StringComparison.Ordinal))
            throw new IOException("Desktop shortcut already exists and is not managed by Kividas.");
        var link = (IKividasShellLinkW)new KividasShellLink();
        try {
            link.SetPath(target); link.SetArguments(arguments); link.SetWorkingDirectory(directory);
            link.SetDescription(description); ((IPersistFile)link).Save(path, true);
        } finally { Marshal.ReleaseComObject(link); }
    }
}
'@
    }
    [KividasWorkspaceShortcut]::Save($ShortcutPath,
        (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
        ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $LauncherPath + '" claude'),
        $ClientHome, ('Kividas SSH workspace: ' + $WorkspaceName))
} catch {
    Write-Host ('  桌面入口未创建：' + $_.Exception.Message) -ForegroundColor DarkYellow
}

Write-Host "`n  ✓ 配置完成：$WorkspaceName · /workspace/claude" -ForegroundColor Green
if ($ProfileReady) { Write-Host '以后在新的 PowerShell 窗口或标签页输入 claude，即可进入远端。' }
Write-Host '也可双击桌面的 Claude SSH。Shell: claude-ssh    Files: claude-sftp'

Write-Host '个人 TXT 含 SSH 密码，请妥善保存。到期自动解绑并清空文件，请提前备份。' -ForegroundColor DarkYellow
if ($Launch) {
    Write-Host "`n  正在进入 $WorkspaceName 的远端 Claude…" -ForegroundColor Cyan
    & $LauncherPath claude
    if ($LASTEXITCODE -ne 0) { Write-Host '远端连接已结束，可双击桌面 Claude SSH 重新连接。' -ForegroundColor DarkYellow }
}
