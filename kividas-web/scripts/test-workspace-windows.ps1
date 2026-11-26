param([switch]$RequireWindows, [switch]$RequireStandardUser)
$ErrorActionPreference = 'Stop'
if ($RequireWindows -and $env:OS -ne 'Windows_NT') { throw 'Actual Windows host required' }
if ($RequireStandardUser) {
    $Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal=New-Object Security.Principal.WindowsPrincipal($Identity)
    if ($Identity.IsSystem -or $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'A non-administrator Windows user is required' }
    $Privileges=(& whoami.exe /priv | Out-String)
    if ($Privileges -match 'SeSecurityPrivilege') { throw 'Test user must not hold SeSecurityPrivilege' }
    Write-Host 'PASS: running as a standard Windows user without SeSecurityPrivilege'
}
function Assert-Workspace($Condition, $Message) { if (-not $Condition) { throw $Message } }
$Resources = Join-Path $PSScriptRoot '../../backend/open_webui/resources/workspace'
$Source = [IO.File]::ReadAllText((Join-Path $Resources 'kividas-ssh-setup.ps1'))
$Root = Join-Path ([IO.Path]::GetTempPath()) ('workspace-windows-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($Root)
$Utf8 = New-Object Text.UTF8Encoding($true)
$Password = 'A' * 32
$User = 'ws_0123456789abcdef'
$Fingerprint = 'SHA256:' + ('A' * 43)
$Connection = Join-Path $Root 'connection file.txt'
function Material($Hash = $Fingerprint) {
    @('KIVIDAS_SSH_CONFIG=1','SSH_NAME=ssh02',"SSH_URL=ssh://${User}@192.0.2.12:2222",("SSH_FINGERPRINT="+$Hash),("SSH_PASSWORD="+$Password),'SSH_DIRECTORY=/workspace/claude') -join "`n"
}
# Execute the real installer through TXT validation, before any Windows/network changes.
$Boundary = $Source.IndexOf("`nStep 2 ")
Assert-Workspace ($Boundary -gt 0) 'Cannot locate the actual TXT validation phase'
$Parse = [ScriptBlock]::Create($Source.Substring(0,$Boundary) + "`nreturn @(`$WorkspaceUser, `$WorkspaceHost, `$WorkspacePort, `$Fields.SSH_PASSWORD)")
function Check-Parse($Text, $Valid) {
    [IO.File]::WriteAllText($Connection,$Text,$Utf8)
    $Failed = $false
    try { $Result = & $Parse -ConnectionFile $Connection } catch { $Failed = $true }
    Assert-Workspace ($Failed -ne $Valid) 'TXT validation result did not match expectation'
    if ($Valid) { Assert-Workspace (($Result -join '|') -ceq "$User|192.0.2.12|2222|$Password") 'TXT fields were changed' }
}
try {
    $Valid = Material
    Check-Parse $Valid $true
    Check-Parse ($Valid.Replace("`n","`r`n") + "`r`n") $true
    foreach ($Bad in @(
        $Valid.Replace('KIVIDAS_SSH_CONFIG=1','KIVIDAS_SSH_CONFIG'),
        ($Valid + "`nSSH_NAME=ssh03"),
        ($Valid + "`nUNEXPECTED=value"),
        $Valid.Replace('SSH_NAME=ssh02','SSH_NAME=$(Get-Process)'),
        $Valid.Replace('192.0.2.12','999.0.2.12'),
        $Valid.Replace('SSH_PASSWORD='+$Password,'SSH_PASSWORD='+$Password+'=unexpected'),
        $Valid.Replace('SSH_DIRECTORY=/workspace/claude','SSH_DIRECTORY=/etc')
    )) { Check-Parse $Bad $false }
    Write-Host 'PASS: actual TXT import, CRLF/BOM, malformed/duplicate/injected fields'
    if ($env:OS -eq 'Windows_NT') {
        # Exercise native Windows key generation, ACLs and .NET AskPass, while
        # replacing the SSH transport with a deterministic, credential-free fixture.
        $SavedHome = $env:KIVIDAS_CLIENT_HOME
        $SavedPath = [Environment]::GetEnvironmentVariable('Path','User')
        $env:KIVIDAS_CLIENT_HOME = Join-Path $Root ('client space '+[char]0x4E2D+[char]0x6587)
        $HostKey = Join-Path $Root 'server-key'
        $Empty = if ($PSVersionTable.PSVersion.Major -lt 7) { '""' } else { '' }
        & ssh-keygen.exe -q -t ed25519 -N $Empty -f $HostKey
        Assert-Workspace ($LASTEXITCODE -eq 0) 'Fixture key generation failed'
        $HostFingerprint = ((& ssh-keygen.exe -lf ($HostKey+'.pub') -E sha256) -split '\s+')[1]
        $global:WorkspaceFixtureState = @{Enrolled=$false; Enrollments=0}
        function ssh-keyscan.exe { throw 'Do not use Windows ssh-keyscan: unsupported hybrid KEX' }
        function sftp.exe { $global:LASTEXITCODE=0 }
        function ssh.exe {
            if ($args -contains '-V') { 'OpenSSH_for_Windows_9.5p1'; $global:LASTEXITCODE=0; return }
            if ($args -contains 'workspace-probe') {
                $ProbeText=[IO.File]::ReadAllText($args[[Array]::IndexOf($args,'-F')+1])
                foreach ($Required in @('PreferredAuthentications none','PubkeyAuthentication no','PasswordAuthentication no','KbdInteractiveAuthentication no','GSSAPIAuthentication no','HostbasedAuthentication no','IdentityAgent none','ForwardAgent no','ClearAllForwardings yes')) {
                    Assert-Workspace ($ProbeText.Contains($Required)) 'Host-key probe could send credentials before verification'
                }
                Assert-Workspace ($ProbeText -match 'UserKnownHostsFile "([^"]+)"') 'Missing isolated host-key file'
                [IO.File]::WriteAllText($Matches[1],('[192.0.2.12]:2222 '+[IO.File]::ReadAllText($HostKey+'.pub')))
                $global:LASTEXITCODE=255; return
            }
            if ($args -contains 'PubkeyAuthentication=no') {
                Assert-Workspace ($env:SSH_ASKPASS -ceq '.\AskPass.exe') 'AskPass environment path must stay ASCII for Windows OpenSSH'
                $Answer = & $env:SSH_ASKPASS
                Assert-Workspace ($Answer -ceq $Password) 'Native AskPass did not read the local bootstrap password'
                Assert-Workspace (($args -join ' ') -notlike ('*'+$Password+'*')) 'Password appeared in arguments'
                $global:WorkspaceFixtureState.Enrolled=$true; $global:WorkspaceFixtureState.Enrollments++; $global:LASTEXITCODE=0; return
            }
            $global:LASTEXITCODE = if ($global:WorkspaceFixtureState.Enrolled) { 0 } else { 255 }
        }
        try {
            [IO.File]::WriteAllText($Connection,(Material $HostFingerprint),$Utf8)
            $InitialLocation=(Get-Location).Path
            & (Join-Path $Resources 'kividas-ssh-setup.ps1') -ConnectionFile $Connection
            Assert-Workspace ((Get-Location).Path -ceq $InitialLocation) 'Setup changed the caller working directory'
            $Base=Join-Path $env:KIVIDAS_CLIENT_HOME ('.kividas/ssh/ssh02-'+$User)
            $Before=[IO.File]::ReadAllText((Join-Path $Base 'id_ed25519'))
            & (Join-Path $Resources 'kividas-ssh-setup.ps1') -ConnectionFile $Connection
            Assert-Workspace ($global:WorkspaceFixtureState.Enrollments -eq 1) 'Repeat setup did not reuse the key'
            Assert-Workspace ([IO.File]::ReadAllText((Join-Path $Base 'id_ed25519')) -ceq $Before) 'Device key changed'
            Assert-Workspace ((Get-Acl -LiteralPath (Join-Path $Base 'id_ed25519')).AreAccessRulesProtected) 'Private key ACL still inherits'
            Assert-Workspace (@(Get-ChildItem -LiteralPath $Base -Force -Filter '.enroll-*').Count -eq 0) 'AskPass password/helper not cleaned up'
            Assert-Workspace (@(Get-ChildItem -LiteralPath $Base -Force -Filter '.host-key-*').Count -eq 0) 'Temporary host-key probe files not cleaned up'
            foreach ($Name in @('claude','claude-ssh','claude-sftp')) {
                Assert-Workspace (Test-Path -LiteralPath (Join-Path $env:KIVIDAS_CLIENT_HOME ('.kividas/bin/'+$Name+'.cmd'))) 'Shortcut missing'
            }
            Write-Host 'PASS: native Windows key generation, ACL, AskPass compilation/password cleanup and repeat enrollment'
            [IO.File]::WriteAllText($Connection,$Valid,$Utf8)
            $Rejected=$false
            try { & (Join-Path $Resources 'kividas-ssh-setup.ps1') -ConnectionFile $Connection } catch { $Rejected=$_.Exception.Message.Contains('fingerprint mismatch') }
            Assert-Workspace $Rejected 'Wrong server fingerprint was accepted'
            Assert-Workspace ($global:WorkspaceFixtureState.Enrollments -eq 1) 'Authentication attempted before server fingerprint verification'
            Write-Host 'PASS: fingerprint mismatch stops before credential use'
        } finally {
            [Environment]::SetEnvironmentVariable('Path',$SavedPath,'User')
            $env:KIVIDAS_CLIENT_HOME=$SavedHome
            Remove-Variable WorkspaceFixtureState -Scope Global
        }
        # Run the actual CMD envelope with the real validation phase as payload.
        # A supplied TXT skips the interactive picker so this also works in CI.
        $Template=[IO.File]::ReadAllText((Join-Path $Resources 'kividas-ssh-setup.cmd'))
        $Output=Join-Path $Root 'cmd-result.txt'
        $CmdSource=$Source.Substring(0,$Boundary)+"`n[IO.File]::WriteAllText(`$env:KIVIDAS_CMD_TEST_OUTPUT,'parsed')"
        $Encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($CmdSource))
        $Cmd=Join-Path $Root 'setup with spaces.cmd'
        [IO.File]::WriteAllText($Cmd,($Template.Replace('__KIVIDAS_POWERSHELL_BASE64__',$Encoded).Replace("`r`n","`n").Replace("`n","`r`n")),[Text.Encoding]::ASCII)
        [IO.File]::WriteAllText($Connection,$Valid,$Utf8)
        $env:KIVIDAS_CMD_TEST_OUTPUT=$Output
        & $env:ComSpec /d /c "call `"$Cmd`" `"$Connection`" < nul"
        Assert-Workspace ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText($Output) -ceq 'parsed') 'CMD envelope did not execute TXT import'
        Remove-Item Env:KIVIDAS_CMD_TEST_OUTPUT
        Write-Host 'PASS: double-click CMD envelope, quoted TXT path and Windows PowerShell execution'
    }
    @{passed=$true;version=$PSVersionTable.PSVersion.ToString();actualWindows=($env:OS -eq 'Windows_NT');standardUser=[bool]$RequireStandardUser} | ConvertTo-Json -Compress
} finally { if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force } }
