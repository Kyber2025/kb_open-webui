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
        $SavedProcessPath = $env:Path
        $SavedPolicy = Get-ExecutionPolicy -Scope CurrentUser
        $env:KIVIDAS_CLIENT_HOME = Join-Path $Root ('client space '+[char]0x4E2D+[char]0x6587)
        $ProfileOriginal = '$global:WorkspaceProfileMarker = "kept"' + "`r`n" + 'function global:claude { throw "Local Claude must not run" }' + "`r`n" + 'Set-Alias -Name claude -Value Write-Output' + "`r`n"
        foreach ($Edition in @('WindowsPowerShell','PowerShell')) {
            $Folder = Join-Path $env:KIVIDAS_CLIENT_HOME ('Documents/'+$Edition)
            [IO.Directory]::CreateDirectory($Folder) | Out-Null
            [IO.File]::WriteAllText((Join-Path $Folder 'Microsoft.PowerShell_profile.ps1'), $ProfileOriginal, $Utf8)
        }
        # Exercise the real native-process boundary, including a child that never
        # exits and one that waits for stdin. Neither can hold setup indefinitely.
        $ParseErrors=$null; $ParseTokens=$null
        $SetupAst=[Management.Automation.Language.Parser]::ParseInput($Source,[ref]$ParseTokens,[ref]$ParseErrors)
        foreach($FunctionName in @('ConvertTo-WorkspaceProcessArgument','Invoke-WorkspaceSetupProcess')) {
            $FunctionAst=$SetupAst.Find({param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq $FunctionName},$true)
            . ([ScriptBlock]::Create($FunctionAst.Extent.Text))
        }
        $NativeRunner=${function:Invoke-WorkspaceSetupProcess}
        $RunnerSource=Join-Path $Root 'runner.cs';$RunnerExe=Join-Path $Root 'runner.exe'
        [IO.File]::WriteAllText($RunnerSource,@'
using System;
using System.IO;
using System.Text;
using System.Threading;
class Runner {
    static void Main(string[] args) {
        if (args[0] == "hang") { File.WriteAllText(args[1], System.Diagnostics.Process.GetCurrentProcess().Id.ToString()); Thread.Sleep(30000); }
        else if (args[0] == "stdin") { Console.Write(Console.In.ReadToEnd().Length == 0 ? "EOF" : "UNEXPECTED_INPUT"); }
        else if (args[0] == "flood") { Console.Write(new string('o',200000)); Console.Error.Write(new string('e',200000)); }
        else { Console.Write(Convert.ToBase64String(Encoding.UTF8.GetBytes(string.Join("\0",args)))); }
    }
}
'@)
        $NativeCompiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        & $NativeCompiler /nologo /target:exe (('/out:')+$RunnerExe) $RunnerSource
        Assert-Workspace ($LASTEXITCODE -eq 0) 'Process boundary fixture did not compile'
        $NativeArguments=@('echo','space value','','quote"value','backslash\"quote','trailing\',('code '+[char]0x4E2D+[char]0x6587))
        $Native=Invoke-WorkspaceSetupProcess $RunnerExe $NativeArguments
        Assert-Workspace ($Native.ExitCode -eq 0 -and [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Native.Output)) -ceq ($NativeArguments -join ([char]0))) 'Process arguments were changed'
        $Native=Invoke-WorkspaceSetupProcess $RunnerExe @('stdin')
        Assert-Workspace ($Native.Output -ceq 'EOF') 'Setup inherited an open stdin handle'
        $Native=Invoke-WorkspaceSetupProcess $RunnerExe @('flood')
        Assert-Workspace ($Native.Output.Length -eq 200000 -and $Native.Error.Length -eq 200000) 'Output pipes were not drained concurrently'
        $PidFile=Join-Path $Root 'hung.pid';$Timer=[Diagnostics.Stopwatch]::StartNew();$TimedOut=$false
        try { Invoke-WorkspaceSetupProcess $RunnerExe @('hang',$PidFile) -TimeoutSeconds 1 | Out-Null } catch { $TimedOut=$true }
        Assert-Workspace ($TimedOut -and $Timer.Elapsed.TotalSeconds -lt 6) 'A stuck child did not time out'
        $HungPid=[int][IO.File]::ReadAllText($PidFile)
        Assert-Workspace (-not (Get-Process -Id $HungPid -ErrorAction SilentlyContinue)) 'Timed-out child was left running'
        Write-Host 'PASS: native argument encoding, closed stdin, concurrent output reads and bounded process termination'
        # Mock only SSH transport for the installer scenarios. The unmodified
        # process runner above and the real SSH canary cover the native boundary.
        $RunnerAst=$SetupAst.Find({param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Invoke-WorkspaceSetupProcess'},$true)
        $MockRunner=@'
function Invoke-WorkspaceSetupProcess {
    param([string]$FilePath,[string[]]$Arguments,[int]$TimeoutSeconds=30)
    if($FilePath -eq $SshExecutable) {
        $Output=@(& ssh.exe @Arguments)
        $ErrorText=if($global:LASTEXITCODE -eq 255){'Permission denied (publickey,password).'}else{''}
        return [pscustomobject]@{ExitCode=$global:LASTEXITCODE;Output=($Output -join "`n");Error=$ErrorText}
    }
    & $NativeRunner @PSBoundParameters
}
'@
        $MockSetup=[ScriptBlock]::Create($Source.Substring(0,$RunnerAst.Extent.StartOffset)+$MockRunner+$Source.Substring($RunnerAst.Extent.EndOffset))
        $HostKey = Join-Path $Root 'server-key'
        $Empty = if ($PSVersionTable.PSVersion.Major -lt 7) { '""' } else { '' }
        & ssh-keygen.exe -q -t ed25519 -N $Empty -f $HostKey
        Assert-Workspace ($LASTEXITCODE -eq 0) 'Fixture key generation failed'
        $HostFingerprint = ((& ssh-keygen.exe -lf ($HostKey+'.pub') -E sha256) -split '\s+')[1]
        $global:WorkspaceFixtureState = @{Enrolled=$false; Enrollments=0; AutoLaunches=0; Checks=0}
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
                $global:WorkspaceFixtureState.Enrolled=$true; $global:WorkspaceFixtureState.Enrollments++; $global:LASTEXITCODE=0; 'KIVIDAS_ENROLLED'; return
            }
            if (($args -join ' ') -like '*cd /workspace/claude && exec python3*') {
                Assert-Workspace $global:WorkspaceFixtureState.Enrolled 'Automatic launch happened before key sign-in'
                $global:WorkspaceFixtureState.AutoLaunches++; $global:LASTEXITCODE=0; return
            }
            foreach($Required in @('-n','-T','IdentityAgent=none')) { Assert-Workspace ($args -contains $Required) 'Setup SSH inherited interactive input or agent' }
            Assert-Workspace ($args[-1] -ceq "printf 'KIVIDAS_KEY_OK\n'") 'Verification did not request a response'
            $global:WorkspaceFixtureState.Checks++
            $global:LASTEXITCODE = if ($global:WorkspaceFixtureState.Enrolled) { 0 } else { 255 }
            if ($global:WorkspaceFixtureState.Enrolled) { 'KIVIDAS_KEY_OK' }
        }
        try {
            [IO.File]::WriteAllText($Connection,(Material $HostFingerprint),$Utf8)
            $InitialLocation=(Get-Location).Path
            & $MockSetup -ConnectionFile $Connection -Launch
            Assert-Workspace ((Get-Location).Path -ceq $InitialLocation) 'Setup changed the caller working directory'
            $Base=Join-Path $env:KIVIDAS_CLIENT_HOME ('.kividas/ssh/ssh02-'+$User)
            $Before=[IO.File]::ReadAllText((Join-Path $Base 'id_ed25519'))
            & $MockSetup -ConnectionFile $Connection
            Assert-Workspace ($global:WorkspaceFixtureState.Enrollments -eq 1) 'Repeat setup did not reuse the key'
            Assert-Workspace ($global:WorkspaceFixtureState.Checks -eq 3) 'Repeat setup performed a redundant verification connection'
            Assert-Workspace ($global:WorkspaceFixtureState.AutoLaunches -eq 1) 'The configured remote Claude was not launched automatically'
            Assert-Workspace ([IO.File]::ReadAllText((Join-Path $Base 'id_ed25519')) -ceq $Before) 'Device key changed'
            Assert-Workspace ((Get-Acl -LiteralPath (Join-Path $Base 'id_ed25519')).AreAccessRulesProtected) 'Private key ACL still inherits'
            Assert-Workspace (@(Get-ChildItem -LiteralPath $Base -Force -Filter '.enroll-*').Count -eq 0) 'AskPass password/helper not cleaned up'
            Assert-Workspace (@(Get-ChildItem -LiteralPath $Base -Force -Filter '.host-key-*').Count -eq 0) 'Temporary host-key probe files not cleaned up'
            foreach ($Name in @('claude','claude-ssh','claude-sftp')) {
                Assert-Workspace (Test-Path -LiteralPath (Join-Path $env:KIVIDAS_CLIENT_HOME ('.kividas/bin/'+$Name+'.cmd'))) 'Shortcut missing'
            }
            foreach ($Edition in @('WindowsPowerShell','PowerShell')) {
                $ProfilePath=Join-Path $env:KIVIDAS_CLIENT_HOME ('Documents/'+$Edition+'/Microsoft.PowerShell_profile.ps1')
                $ProfileText=[IO.File]::ReadAllText($ProfilePath)
                Assert-Workspace ($ProfileText.Contains($ProfileOriginal.TrimEnd())) 'Existing PowerShell profile was changed'
                Assert-Workspace ([regex]::Matches($ProfileText,'# BEGIN KIVIDAS WORKSPACE').Count -eq 1) 'Duplicate managed profile block'
                Assert-Workspace ([IO.File]::ReadAllText($ProfilePath+'.before-kividas') -ceq $ProfileOriginal) 'Profile backup was not preserved'
            }
            $Link=[KividasWorkspaceShortcut]::Read((Join-Path $env:KIVIDAS_CLIENT_HOME 'Desktop/Claude SSH.lnk'))
            Assert-Workspace ($Link[1].Contains((Join-Path $Base 'launch.ps1')) -and $Link[0] -eq 'Kividas SSH workspace: ssh02') 'Desktop entry does not select the installed workspace'
            # Exercise command selection in a fresh native PowerShell process with
            # a stale PATH, an old local binary, and an existing alias/function.
            $Stub=Join-Path $Root 'stale-path';[IO.Directory]::CreateDirectory($Stub) | Out-Null
            $Compiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
            $StubSource=Join-Path $Stub 'stub.cs'
            [IO.File]::WriteAllText($StubSource,'using System; using System.Text; class Stub { static void Main(string[] args) { Console.WriteLine("REMOTE_SSH="+Convert.ToBase64String(Encoding.UTF8.GetBytes(string.Join("\0",args)))); } }')
            & $Compiler /nologo /target:exe (('/out:')+(Join-Path $Stub 'ssh.exe')) $StubSource
            Assert-Workspace ($LASTEXITCODE -eq 0) 'SSH transport fixture compilation failed'
            [IO.File]::WriteAllText((Join-Path $Stub 'claude.cmd'),"@echo LOCAL_CLAUDE_MUST_NOT_RUN`r`n",[Text.Encoding]::ASCII)
            $env:Path=$Stub+';'+$SavedProcessPath
            $Edition=if($PSVersionTable.PSVersion.Major -lt 6){'WindowsPowerShell'}else{'PowerShell'}
            $env:KIVIDAS_TEST_PROFILE=Join-Path $env:KIVIDAS_CLIENT_HOME ('Documents/'+$Edition+'/Microsoft.PowerShell_profile.ps1')
            $env:KIVIDAS_TEST_ARGS=ConvertTo-Json -InputObject @('space value','',('code '+[char]0x4E2D+[char]0x6587)) -Compress
            $ChildCommand='. $env:KIVIDAS_TEST_PROFILE; if($global:WorkspaceProfileMarker -ne "kept"){throw "Existing profile did not run"}; $a=ConvertFrom-Json $env:KIVIDAS_TEST_ARGS; claude @a'
            $Child=& (Get-Process -Id $PID).Path -NoLogo -NoProfile -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ChildCommand)))
            Assert-Workspace ($LASTEXITCODE -eq 0) 'Fresh PowerShell could not start the remote command'
            $Record=@($Child | Where-Object { $_ -like 'REMOTE_SSH=*' })
            Assert-Workspace ($Record.Count -eq 1 -and ($Child -join '') -notlike '*LOCAL_CLAUDE*') 'Stale PATH or local Claude took priority'
            $SshArgs=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Record[0].Substring(11))) -split ([char]0)
            $Remote=$SshArgs[-1];$Payload=($Remote -split ' ')[-1]
            $RemoteArgs=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)))
            Assert-Workspace ($RemoteArgs[0] -eq '/usr/local/bin/workspace-session' -and $RemoteArgs[1] -eq 'claude' -and $RemoteArgs[2] -eq 'space value' -and $RemoteArgs[3] -ceq '') 'Remote command arguments changed'
            Remove-Item Env:KIVIDAS_TEST_PROFILE,Env:KIVIDAS_TEST_ARGS
            $env:Path=$SavedProcessPath
            Write-Host 'PASS: automatic remote launch, desktop entry, preserved profiles and remote command priority over stale PATH/local Claude'
            Write-Host 'PASS: native Windows key generation, ACL, AskPass compilation/password cleanup and repeat enrollment'
            [IO.File]::WriteAllText($Connection,$Valid,$Utf8)
            $Rejected=$false
            try { & $MockSetup -ConnectionFile $Connection } catch { $Rejected=$_.Exception.Message.Contains('fingerprint mismatch') }
            Assert-Workspace $Rejected 'Wrong server fingerprint was accepted'
            Assert-Workspace ($global:WorkspaceFixtureState.Enrollments -eq 1) 'Authentication attempted before server fingerprint verification'
            Write-Host 'PASS: fingerprint mismatch stops before credential use'
        } finally {
            [Environment]::SetEnvironmentVariable('Path',$SavedPath,'User')
            $env:Path=$SavedProcessPath
            Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy $SavedPolicy -Force -ErrorAction SilentlyContinue
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
