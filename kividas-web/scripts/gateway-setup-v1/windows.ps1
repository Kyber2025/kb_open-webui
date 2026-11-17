param([switch]$LibraryOnly,[switch]$PrivacyOnly,[switch]$RestorePrivacy)
$ErrorActionPreference = 'Stop'
$script:GatewayUrl = 'https://ai.kividas.com/api'
$script:IdPattern = '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'

function ConvertTo-KiviMap($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        $map = [ordered]@{}; foreach ($key in $Value.Keys) { $map[$key] = ConvertTo-KiviMap $Value[$key] }; return ,$map
    }
    if ($Value -is [pscustomobject]) {
        $map = [ordered]@{}; foreach ($p in $Value.PSObject.Properties) { $map[$p.Name] = ConvertTo-KiviMap $p.Value }; return ,$map
    }
    if ($Value -is [array]) { $items = @(); foreach ($item in $Value) { $items += ,(ConvertTo-KiviMap $item) }; return ,$items }
    return $Value
}
function Read-KiviJson($Raw, $Label) {
    if ($null -eq $Raw) { return ,([ordered]@{}) }
    try {
        $value = ConvertTo-KiviMap (ConvertFrom-Json -InputObject $Raw.TrimStart([char]0xfeff))
        if ($value -isnot [System.Collections.IDictionary]) { throw 'not object' }; return ,$value
    } catch { throw "$Label 不是有效 JSON，请先修复；原文件未覆盖。" }
}
function ConvertTo-KiviJson($Value) { return (($Value | ConvertTo-Json -Depth 100) + "`n") }
function Test-KiviCredentials($Key, $InstallationId) {
    $Key = ([string]$Key).Trim(); $InstallationId = ([string]$InstallationId).Trim()
    if ($Key -cnotmatch '^sk-kiv-desktop-[A-Za-z0-9_-]{40,128}$') { throw '请填写完整的 Kividas Gateway API key。' }
    if ($InstallationId -notmatch $script:IdPattern) { throw '安装识别码应为管理员配发的 UUID；不要自行生成或更换。' }
    return @{ key=$Key; id=$InstallationId }
}
function Read-KiviCredentialsText($Text) {
    $keys=@(); $ids=@()
    foreach ($line in $Text.TrimStart([char]0xfeff) -split '\r?\n') {
        if ($line -match '^\s*Gateway API key\s*[:：]\s*(\S+)\s*$') { $keys += $Matches[1] }
        if ($line -match '^\s*(?:安装识别码|Installation ID|值[（(]Value[）)])\s*[:：]\s*(\S+)\s*$') { $ids += $Matches[1] }
    }
    if ($keys.Count -ne 1 -or $ids.Count -ne 1) { throw 'TXT 必须包含一套明确的 Gateway API key 和安装识别码（或“值（Value）”）。请使用后台下载的客户接入资料。' }
    return Test-KiviCredentials $keys[0] $ids[0]
}
function Assert-KiviPath($Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item=Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '配置路径含符号链接或重解析点，请联系服务方确认位置。' }
        }
        $parent=[IO.Path]::GetDirectoryName($current); if ($parent -eq $current) { break }; $current=$parent
    }
}
function Read-KiviFile($Path) {
    Assert-KiviPath $Path
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $utf8=New-Object Text.UTF8Encoding($false,$true)
    try { return [IO.File]::ReadAllText($Path,$utf8) } catch { throw '无法读取配置文件，请检查权限和 UTF-8 编码。' }
}
function Protect-KiviFile($Path) {
    if ($env:OS -ne 'Windows_NT') { return } # Isolated portability tests on macOS.
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl=New-Object Security.AccessControl.FileSecurity
    # Modify ONLY the DACL. Set-Acl's provider can persist Audit/Owner/Group as well,
    # causing SeSecurityPrivilege failures in ordinary, non-elevated sessions.
    # Access-only .NET persistence leaves the SACL and ownership untouched.
    $acl.SetSecurityDescriptorSddlForm(('D:P(A;;FA;;;'+$sid+')(A;;FA;;;SY)'),[Security.AccessControl.AccessControlSections]::Access)
    if ($PSVersionTable.PSEdition -eq 'Core') {
        [IO.FileSystemAclExtensions]::SetAccessControl((New-Object IO.FileInfo($Path)),$acl)
    } else {
        [IO.File]::SetAccessControl($Path,$acl) # Windows PowerShell 5.1 / .NET Framework
    }
}
function Write-KiviFile($Path,$Text) {
    Assert-KiviPath $Path
    $parent=[IO.Path]::GetDirectoryName($Path)
    [void][IO.Directory]::CreateDirectory($parent)
    $temporary=Join-Path $parent ('.kividas-'+[guid]::NewGuid().ToString()+'.tmp')
    try {
        [IO.File]::WriteAllText($temporary,'',(New-Object Text.UTF8Encoding($false)))
        Protect-KiviFile $temporary
        [IO.File]::WriteAllText($temporary,$Text,(New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary,$Path,[NullString]::Value) } else { [IO.File]::Move($temporary,$Path) }
        Protect-KiviFile $Path
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Remove-KiviFile($Path) { Assert-KiviPath $Path; if ([IO.File]::Exists($Path)) { [IO.File]::Delete($Path) } }
function Read-KiviStartupEnv($Name) {
    if ($Name -cne '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL') { throw '未知桌面启动设置。' }
    return [Environment]::GetEnvironmentVariable($Name,'User')
}
function Write-KiviStartupEnv($Name,$Value) {
    if ($Name -cne '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL') { throw '未知桌面启动设置。' }
    if ($env:OS -ne 'Windows_NT') { throw '桌面启动环境必须在 Windows 上配置。' }
    [Environment]::SetEnvironmentVariable($Name,$Value,'User')
    if (!("KiviStartupNotify" -as [type])) {
        Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class KiviStartupNotify{[DllImport("user32.dll",CharSet=CharSet.Auto,SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);}'
    }
    $result=[UIntPtr]::Zero
    [void][KiviStartupNotify]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result)
}
function Read-KiviChange($Change) {
    if ($Change.kind -eq 'environment') { return Read-KiviStartupEnv $Change.name }
    return Read-KiviFile $Change.path
}
function Write-KiviChange($Change,$Value) {
    if ($Change.kind -eq 'environment') { Write-KiviStartupEnv $Change.name $Value }
    elseif ($null -eq $Value) { Remove-KiviFile $Change.path }
    else { Write-KiviFile $Change.path $Value }
}

function Test-KiviGatewayUrl($Value) { return $Value -ceq $script:GatewayUrl -or $Value -ceq ($script:GatewayUrl+'/') }
function Set-KiviDesktopPrivacy($Profile) {
    $Profile.disableNonessentialTelemetry=$true
    $Profile.disableEssentialTelemetry=$true
    if ($Profile.Contains('telemetry')) {
        if ($Profile.telemetry -isnot [System.Collections.IDictionary]) { throw '桌面隐私设置格式不正确，未修改配置。' }
        $Profile.telemetry.disableNonessential=$true
        $Profile.telemetry.disableEssential=$true
    }
}
function Set-KiviCliPrivacy($EnvMap) {
    $EnvMap.DISABLE_TELEMETRY='1'
    $EnvMap.DISABLE_ERROR_REPORTING='1'
    $EnvMap.CLAUDE_CODE_ENABLE_TELEMETRY='0'
    $EnvMap.OTEL_SDK_DISABLED='true'
}
function New-KiviPrivacyPlan($Paths) {
    $changes=New-Object 'System.Collections.Generic.List[object]'
    $clients=New-Object 'System.Collections.Generic.List[string]'
    $skipped=New-Object 'System.Collections.Generic.List[string]'
    $raw=Read-KiviFile (Join-Path $Paths.desktop '_meta.json')
    if ($null -eq $raw) {
        if ((Test-Path -LiteralPath $Paths.desktop) -and @(Get-ChildItem -LiteralPath $Paths.desktop -Filter '*.json').Count) { throw '桌面配置索引缺失，请先修复；本次未更新。' }
        $skipped.Add('Desktop：未找到现有配置')
    } else {
        $meta=Read-KiviJson $raw '桌面配置索引'
        if ($meta.hybridPointer) { throw '桌面端由企业登录管理，请联系管理员更新隐私设置。' }
        if ($meta.entries -isnot [array] -or $meta.appliedId -isnot [string]) { throw '桌面配置索引格式未知，本次未更新。' }
        $seen=@{}
        foreach ($entry in $meta.entries) {
            if (!$entry -or $entry.id -notmatch $script:IdPattern -or $seen.ContainsKey($entry.id) -or $entry.name -isnot [string]) { throw '桌面配置索引含无效或重复记录。' }
            $seen[$entry.id]=$true
        }
        if ($meta.appliedId -and !$seen.ContainsKey($meta.appliedId)) { throw '当前桌面配置不在索引中，请先修复。' }
        if ($meta.appliedId) {
            $path=Join-Path $Paths.desktop ($meta.appliedId+'.json');$before=Read-KiviFile $path
            if ($null -eq $before) { throw '当前桌面配置文件缺失，请先修复。' }
            $profile=Read-KiviJson $before '当前桌面配置'
            if ($profile.inferenceProvider -ceq 'gateway' -and (Test-KiviGatewayUrl $profile.inferenceGatewayBaseUrl)) {
                if ($profile.bootstrapUrl -or $profile.selfHosted -or $profile.sessionHost) { throw '当前桌面配置由服务器管理，请联系管理员更新。' }
                Set-KiviDesktopPrivacy $profile
                $clients.Add('Desktop');$after=ConvertTo-KiviJson $profile
                if ($before -cne $after) { $changes.Add(@{path=$path;before=$before;after=$after}) }
            } else { $skipped.Add('Desktop：当前启用的不是 Kividas 网关') }
        } else { $skipped.Add('Desktop：没有启用的网关配置') }
    }
    $raw=Read-KiviFile $Paths.cli
    if ($null -eq $raw) { $skipped.Add('CLI：未找到现有配置') }
    else {
        $cli=Read-KiviJson $raw 'CLI settings.json';$settingsEnv=$cli.env
        if ($null -eq $settingsEnv -and !$cli.Contains('env')) { $settingsEnv=[ordered]@{} }
        if ($settingsEnv -isnot [System.Collections.IDictionary]) { throw 'CLI env 格式不正确，未修改配置。' }
        if (Test-KiviGatewayUrl $settingsEnv.ANTHROPIC_BASE_URL) {
            Set-KiviCliPrivacy $settingsEnv;$cli.env=$settingsEnv;$clients.Add('CLI')
            $after=ConvertTo-KiviJson $cli
            if ($raw -cne $after) { $changes.Add(@{path=$Paths.cli;before=$raw;after=$after}) }
        } else { $skipped.Add('CLI：当前配置未使用 Kividas 网关') }
    }
    if (!$clients.Count) { throw '没有找到当前启用的 Kividas 配置。请确认此电脑已接入 Kividas；无需重新生成 Key 或识别码。' }
    return @{changes=@($changes.ToArray());clients=@($clients.ToArray());skipped=@($skipped.ToArray())}
}
function Get-KiviPrivacyPaths {
    if ($env:CLAUDE_CONFIG_DIR -or $env:CLAUDE_USER_DATA_DIR) { throw '检测到自定义配置目录，请联系服务方适配该位置。' }
    if (@(Get-Process -Name Claude -ErrorAction SilentlyContinue).Count) { throw '请先保存任务，从 Claude 菜单选择 File → Exit，并结束 CLI 会话，再运行更新。' }
    foreach ($hive in @('HKLM:\SOFTWARE\Policies\Claude','HKCU:\SOFTWARE\Policies\Claude','HKLM:\SOFTWARE\Policies\ClaudeCode','HKCU:\SOFTWARE\Policies\ClaudeCode')) {
        if ((Test-Path $hive) -and (Get-Item $hive).GetValueNames().Count) { throw '此电脑有 Claude 管理策略，请联系管理员更新隐私设置。' }
    }
    if (Test-Path (Join-Path $env:ProgramFiles 'ClaudeCode\managed-settings.json')) { throw 'CLI 已有管理策略，请联系管理员更新隐私设置。' }
    if (!(Test-Path (Join-Path $env:LOCALAPPDATA 'Claude-3p')) -and (Test-Path (Join-Path $env:APPDATA 'Claude-3p'))) { throw '检测到旧版桌面数据目录，请先完成官方 Claude 数据迁移，退出后再更新。' }
    return @{desktop=(Join-Path $env:LOCALAPPDATA 'Claude-3p\configLibrary');cli=(Join-Path $env:USERPROFILE '.claude\settings.json');mcp=(Join-Path $env:USERPROFILE '.claude.json')}
}
function Invoke-KiviPrivacyUpdate([switch]$Restore) {
    $paths=Get-KiviPrivacyPaths
    $backups=Join-Path $env:LOCALAPPDATA 'KividasSetup\backups'
    if ($Restore) {
        $pending=@(Get-ChildItem -LiteralPath $backups -Filter '*.json' -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '-privacy-'} | Sort-Object Name -Descending | Where-Object {$m=Read-KiviJson (Read-KiviFile $_.FullName) '备份';$m.status -eq 'applied' -and !$m.restored})
        if (!$pending.Count) { throw '没有可以恢复的隐私更新备份。' }
        Restore-KiviBackup $pending[0].FullName $paths
        return '已恢复上一次隐私设置。请重新打开 Claude 和 CLI。'
    }
    $plan=New-KiviPrivacyPlan $paths
    $backup=Join-Path $backups ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fff')+'-privacy-'+[guid]::NewGuid().ToString()+'.json')
    $changed=Save-KiviPlan $plan.changes $backup
    # Read back the effective files. Success requires all planned settings to remain closed.
    $verify=New-KiviPrivacyPlan $paths
    if ($verify.changes.Count -or (($verify.clients -join ',') -cne ($plan.clients -join ','))) { throw '更新后配置又发生变化，请保留备份并联系服务方。' }
    $message='隐私设置已更新并备份。';if(!$changed){$message='隐私设置已经关闭，无需重复更新。'}
    $message+="`n已核对："+($plan.clients -join '、')
    if ($plan.skipped.Count) { $message+="`n"+($plan.skipped -join "`n") }
    $message+="`n`n请重新打开 Claude 和 CLI，新建会话后测试对话和工具调用。`n不需要重新登录、填写 Key 或安装识别码。`n本工具只验证本机配置；正常联网与工具调用需在新会话确认。`n如需撤销，运行同目录的「恢复Windows.cmd」。"
    return $message
}

function New-KiviPlan($Paths,$Target,$Credentials) {
    if ($Target -eq 'privacy') { return ,@((New-KiviPrivacyPlan $Paths).changes) }
    if ($Target -eq 'mcp') { return ,@(New-KiviMcpPlan $Paths $Credentials.key) }
    $creds=Test-KiviCredentials $Credentials.key $Credentials.id
    if ($Target -notin @('both','desktop','cli')) { throw '请选择桌面端、CLI 或两者。' }
    $changes=New-Object 'System.Collections.Generic.List[object]'
    if ($Target -ne 'cli') {
        $metaPath=Join-Path $Paths.desktop '_meta.json'; $raw=Read-KiviFile $metaPath
        if ($null -eq $raw) {
            if ((Test-Path -LiteralPath $Paths.desktop) -and @(Get-ChildItem -LiteralPath $Paths.desktop -Filter '*.json').Count) { throw '桌面配置目录已有文件，但缺少 _meta.json，请先检查原配置。' }
            $meta=[ordered]@{appliedId='';entries=@()}
        } else { $meta=Read-KiviJson $raw '桌面配置索引' }
        if ($meta.hybridPointer) { throw '桌面端正在使用企业托管登录，请先通过原配置方式退出该部署。' }
        if ($meta.entries -isnot [array] -or $meta.appliedId -isnot [string]) { throw '桌面配置索引格式未知，请联系服务方。' }
        $seen=@{}; $candidates=@()
        foreach ($entry in $meta.entries) {
            if ($entry.id -notmatch $script:IdPattern -or $seen.ContainsKey($entry.id) -or $entry.name -isnot [string]) { throw '桌面配置索引含无效或重复记录。' }
            $seen[$entry.id]=$true
            $profileRaw=Read-KiviFile (Join-Path $Paths.desktop ($entry.id+'.json'))
            if ($null -eq $profileRaw) { throw '桌面索引引用了缺失的配置文件，请先修复。' }
            $desktopCfg=Read-KiviJson $profileRaw '桌面已存配置'
            if ($desktopCfg.inferenceGatewayBaseUrl -eq $script:GatewayUrl -and !$desktopCfg.bootstrapUrl -and ($entry.id -eq $meta.appliedId -or $entry.name -eq 'Kividas')) { $candidates += @{entry=$entry;config=$desktopCfg} }
        }
        if ($meta.appliedId -and !$seen.ContainsKey($meta.appliedId)) { throw '桌面当前配置不在索引中，请先修复。' }
        $active=@($candidates | Where-Object { $_.entry.id -eq $meta.appliedId }) | Select-Object -First 1
        if (!$active -and $candidates.Count -gt 1) { throw '找到多份 Kividas 配置，无法确定应更新哪一份。' }
        if (!$active -and $candidates.Count) { $active=$candidates[0] }
        if ($active) { $entry=$active.entry; $desktopCfg=$active.config } else { $entry=[ordered]@{id=[guid]::NewGuid().ToString();name='Kividas'}; $desktopCfg=[ordered]@{} }
        $profilePath=Join-Path $Paths.desktop ($entry.id+'.json')
        if (!$active -and (Test-Path -LiteralPath $profilePath)) { throw '新配置 ID 发生冲突，请重试。' }
        $headers=[ordered]@{'X-Kividas-Device-ID'=$creds.id;'X-Kividas-Config-Version'='v1'}
        $desktopCfg.inferenceProvider='gateway'; $desktopCfg.inferenceCredentialKind='static'
        $desktopCfg.inferenceGatewayBaseUrl=$script:GatewayUrl; $desktopCfg.inferenceGatewayApiKey=$creds.key
        $desktopCfg.inferenceGatewayAuthScheme='bearer'; $desktopCfg.inferenceCustomHeaders=$headers
        $desktopCfg.modelDiscoveryEnabled=$true; $desktopCfg.isClaudeCodeForDesktopEnabled=$true
        $desktopCfg.toolSearchEnabled=$true
        Set-KiviDesktopPrivacy $desktopCfg
        $desktopCfg.Remove('inferenceModels')
        if (!$desktopCfg.deploymentDisplayName) { $desktopCfg.deploymentDisplayName='Kividas' }
        if (!$active) { $meta.entries += ,$entry }
        $meta.appliedId=$entry.id
        $changes.Add(@{path=$profilePath;before=(Read-KiviFile $profilePath);after=(ConvertTo-KiviJson $desktopCfg)})
        $changes.Add(@{path=$metaPath;before=$raw;after=(ConvertTo-KiviJson $meta)})
        if ($Paths.desktopMode) {
            $modeRaw=Read-KiviFile $Paths.desktopMode;$mode=Read-KiviJson $modeRaw '桌面启动方式'
            $mode.deploymentMode='3p'
            $changes.Add(@{path=$Paths.desktopMode;before=$modeRaw;after=(ConvertTo-KiviJson $mode)})
        }
        if ($Paths.desktopStartup) {
            $name='_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'
            $changes.Add(@{kind='environment';name=$name;before=(Read-KiviStartupEnv $name);after='1'})
        }
    }
    if ($Target -ne 'desktop') {
        $raw=Read-KiviFile $Paths.cli; $cli=Read-KiviJson $raw 'CLI settings.json'
        $settingsEnv=$cli.env; if ($null -eq $settingsEnv) { $settingsEnv=[ordered]@{} }
        if ($settingsEnv -isnot [System.Collections.IDictionary]) { throw 'CLI env 格式不正确。' }
        foreach ($name in @($settingsEnv.Keys)) {
            if ($name -cmatch '^(ANTHROPIC_(BASE_URL|AUTH_TOKEN|API_KEY|CUSTOM_HEADERS|MODEL|SMALL_FAST_MODEL|DEFAULT_.*_MODEL|.*_BASE_URL)|CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY))$') { $settingsEnv.Remove($name) }
        }
        foreach ($name in @('apiKeyHelper','forceLoginMethod','forceLoginGatewayUrl','forceLoginOrgUUID','model','smallFastModel')) { $cli.Remove($name) }
        $settingsEnv.ANTHROPIC_BASE_URL=$script:GatewayUrl; $settingsEnv.ANTHROPIC_AUTH_TOKEN=$creds.key
        $settingsEnv._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL='1'
        $settingsEnv.ANTHROPIC_CUSTOM_HEADERS='X-Kividas-Device-ID: '+$creds.id+"`nX-Kividas-Config-Version: v1"; $settingsEnv.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='1'
        Set-KiviCliPrivacy $settingsEnv
        $orderedEnv=[ordered]@{}
        foreach ($name in @($settingsEnv.Keys | Sort-Object)) { $orderedEnv[$name]=$settingsEnv[$name] }
        $cli.env=$orderedEnv; $cli.promptCacheTtl='1h'
        $changes.Add(@{path=$Paths.cli;before=$raw;after=(ConvertTo-KiviJson $cli)})
    }
    # Desktop Code shares this cache setting; preserve CLI access credentials.
    if ($Target -eq 'desktop') {
        $raw=Read-KiviFile $Paths.cli; $shared=Read-KiviJson $raw 'Code settings.json'
        $shared.promptCacheTtl='1h'
        $changes.Add(@{path=$Paths.cli;before=$raw;after=(ConvertTo-KiviJson $shared)})
    }
    if ($Paths.mcp) { foreach ($mcpChange in @(New-KiviMcpPlan $Paths $creds.key)) { $changes.Add($mcpChange) } }
    return ,@($changes | Where-Object { $_.before -cne $_.after })
}
function Save-KiviPlan($Changes,$Backup) {
    if (!$Changes.Count) { return $false }
    foreach ($change in $Changes) { if ((Read-KiviChange $change) -cne $change.before) { throw '配置被其他程序更改，请退出客户端后重试。' } }
    $manifest=[ordered]@{version=1;status='pending';restored=$false;entries=@($Changes)}
    Write-KiviFile $Backup (ConvertTo-KiviJson $manifest)
    $written=New-Object 'System.Collections.Generic.List[object]'
    try {
        foreach ($change in $Changes) {
            if ((Read-KiviChange $change) -cne $change.before) { throw 'Concurrent write' }
            $written.Add($change); Write-KiviChange $change $change.after
            if ((Read-KiviChange $change) -cne $change.after) { throw 'Verify failed' }
        }
        $manifest.status='applied'; Write-KiviFile $Backup (ConvertTo-KiviJson $manifest)
    } catch {
        $errors=0
        for ($i=$written.Count-1;$i -ge 0;$i--) {
            $change=$written[$i]
            try { Write-KiviChange $change $change.before } catch { $errors++ }
        }
        $manifest.status='rolled_back';if($errors){$manifest.status='partial'}
        try { Write-KiviFile $Backup (ConvertTo-KiviJson $manifest) } catch {}
        if ($errors) { throw '写入失败，部分恢复未完成。请保留备份并联系服务方。' }
        throw '写入失败，本次更改已恢复。请检查文件权限后重试。'
    }
    return $true
}
function Restore-KiviBackup($Backup,$Paths) {
    $manifest=Read-KiviJson (Read-KiviFile $Backup) '备份'
    if ($manifest.version -ne 1 -or $manifest.status -ne 'applied' -or $manifest.restored -or $manifest.entries -isnot [array]) { throw '该备份不可恢复或已经恢复过。' }
    foreach ($entry in $manifest.entries) {
        if ($entry.kind -eq 'environment') {
            if (!$Paths.desktopStartup -or $entry.name -cne '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL' -or $entry.after -cne '1') { throw '备份包含意外环境设置，已停止。' }
        } else {
            if ($entry.kind -or $entry.path -isnot [string]) { throw '备份内容格式不正确。' }
            $parent=[IO.Path]::GetDirectoryName($entry.path); $name=[IO.Path]::GetFileName($entry.path)
            if ($entry.path -ne $Paths.cli -and $entry.path -ne $Paths.mcp -and $entry.path -ne $Paths.desktopMode -and !($parent -eq $Paths.desktop -and ($name -eq '_meta.json' -or ($name -match '\.json$' -and [IO.Path]::GetFileNameWithoutExtension($name) -match $script:IdPattern)))) { throw '备份包含意外路径，已停止。' }
        }
        if ($entry.after -isnot [string] -or !($null -eq $entry.before -or $entry.before -is [string])) { throw '备份内容格式不正确。' }
        if ((Read-KiviChange $entry) -cne $entry.after) { throw '配置在运行工具后又被修改。为保留后续更改，本次不自动恢复，请联系服务方使用备份。' }
    }
    $done=New-Object 'System.Collections.Generic.List[object]'
    try {
        for($i=$manifest.entries.Count-1;$i -ge 0;$i--) {
            $entry=$manifest.entries[$i]; $done.Add($entry)
            Write-KiviChange $entry $entry.before
        }
    } catch {
        for($i=$done.Count-1;$i -ge 0;$i--) { try { Write-KiviChange $done[$i] $done[$i].after } catch {} }
        throw '恢复未完成，请保留备份并检查文件权限。'
    }
    $manifest.restored=$true; Write-KiviFile $Backup (ConvertTo-KiviJson $manifest)
}
function Test-KiviMcpKey($Key) {
    $Key=([string]$Key).Trim()
    if ($Key -cnotmatch '^sk-kiv-desktop-[A-Za-z0-9_-]{40,128}$') { throw '未找到完整的 Kividas 网关 Key。' }
    return $Key
}
function New-KiviMcpPlan($Paths,$Key) {
    $Key=Test-KiviMcpKey $Key
    if (!$Paths.mcp) { throw '缺少 MCP 配置位置。' }
    $raw=Read-KiviFile $Paths.mcp;$config=Read-KiviJson $raw 'MCP .claude.json'
    $servers=$config.mcpServers;if ($null -eq $servers) { $servers=[ordered]@{} }
    if ($servers -isnot [System.Collections.IDictionary]) { throw 'MCP 列表格式不正确，未修改配置。' }
    $servers['kividas-usage']=[ordered]@{type='http';url=($script:GatewayUrl+'/mcp/usage');headers=[ordered]@{Authorization=('Bearer '+$Key)}}
    $legacy=$servers['kividas-usage-remote']
    if ($legacy -and $legacy.type -eq 'http' -and $legacy.url -ceq ($script:GatewayUrl+'/mcp/usage')) { $servers.Remove('kividas-usage-remote') }
    $config.mcpServers=$servers;$after=ConvertTo-KiviJson $config
    if ($raw -cne $after) { return @{path=$Paths.mcp;before=$raw;after=$after} }
}
function Open-KiviDesktopKey($Value) {
    if (!$Value -or !$Value.StartsWith('__sealed__:v1:')) { return $Value }
    Add-Type -AssemblyName System.Security
    $protection='anthropic.claude.crossProfileSecret.v1'
    $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Value.Substring('__sealed__:v1:'.Length)),[Text.Encoding]::UTF8.GetBytes($protection),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
        $text=[Text.Encoding]::UTF8.GetString($plain)
        if (!$text.StartsWith($protection+':')) { throw 'Invalid sealed key' }
        $record=Read-KiviJson $text.Substring($protection.Length+1) '桌面加密配置'
        if ($record.configLibrary.key -ne 'inferenceGatewayApiKey') { throw 'Invalid sealed field' }
        return $record.configLibrary.value
    } finally { [Array]::Clear($plain,0,$plain.Length) }
}
function Get-KiviExistingKeys($Paths) {
    $found=New-Object 'System.Collections.Generic.List[object]'
    $raw=Read-KiviFile $Paths.cli
    if ($null -ne $raw) {
        $cli=Read-KiviJson $raw 'CLI settings.json'
        if ($cli.env.ANTHROPIC_BASE_URL -in @($script:GatewayUrl,($script:GatewayUrl+'/'))) {
            $candidate=$cli.env.ANTHROPIC_AUTH_TOKEN;if (!$candidate) { $candidate=$cli.env.ANTHROPIC_API_KEY }
            try { $found.Add(@{key=(Test-KiviMcpKey $candidate);source='Claude Code CLI'}) } catch {}
        }
    }
    $raw=Read-KiviFile (Join-Path $Paths.desktop '_meta.json')
    if ($null -ne $raw) {
        $meta=Read-KiviJson $raw '桌面配置索引'
        if ($meta.appliedId -match $script:IdPattern -and !$meta.hybridPointer) {
            $raw=Read-KiviFile (Join-Path $Paths.desktop ($meta.appliedId+'.json'))
            if ($null -ne $raw) {
                $config=Read-KiviJson $raw '桌面配置'
                if ($config.inferenceProvider -eq 'gateway' -and $config.inferenceGatewayBaseUrl -in @($script:GatewayUrl,($script:GatewayUrl+'/'))) {
                    try { $candidate=Test-KiviMcpKey (Open-KiviDesktopKey $config.inferenceGatewayApiKey);if (!@($found | Where-Object {$_.key -ceq $candidate}).Count) { $found.Add(@{key=$candidate;source='Claude Desktop'}) } } catch {}
                }
            }
        }
    }
    return $found.ToArray()
}
function Test-KiviRemoteMcp($Key) {
    $Key=Test-KiviMcpKey $Key
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"kividas-setup","version":"v1"}}}'
    try {
        $reply=Invoke-RestMethod -Uri ($script:GatewayUrl+'/mcp/usage') -Method Post -Headers @{Authorization=('Bearer '+$Key);Accept='application/json, text/event-stream'} -ContentType 'application/json' -Body $body -TimeoutSec 15 -MaximumRedirection 0
        if ($reply.result.serverInfo.name -ne 'kividas-usage') { throw 'Unexpected MCP server' }
        return $true
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in @(401,403)) { return $false }
        throw '暂时无法验证用量服务，请联网后重试。本次未修改配置。'
    }
}

function Start-KiviSetup {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $form=New-Object Windows.Forms.Form
    $form.Text='Kividas 一键配置 · v1';$form.ClientSize=New-Object Drawing.Size(680,580)
    $form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
    $form.AutoScaleDimensions=New-Object Drawing.SizeF(96,96);$form.AutoScaleMode='Dpi';$form.BackColor=[Drawing.ColorTranslator]::FromHtml('#F5F7FB')
    $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
    $ink=[Drawing.ColorTranslator]::FromHtml('#17233B');$muted=[Drawing.ColorTranslator]::FromHtml('#64748B');$accent=[Drawing.ColorTranslator]::FromHtml('#295EDE')
    function TextLabel($Text,$X,$Y,$W,$H,$Size,$Color) {
        $label=New-Object Windows.Forms.Label;$label.Text=$Text;$label.Location=New-Object Drawing.Point($X,$Y);$label.Size=New-Object Drawing.Size($W,$H)
        $label.Font=New-Object Drawing.Font('Microsoft YaHei UI',$Size);$label.ForeColor=$Color;$form.Controls.Add($label);return $label
    }
    [void](TextLabel 'K I V I D A S   /   R6' 28 23 600 25 10 $accent)
    [void](TextLabel '配置 Claude' 25 58 600 44 25 $ink)
    [void](TextLabel '连接就绪，从这里开始。' 29 109 600 28 11 $muted)
    $included=TextLabel '接入初始化     ·     用量 MCP     ·     关闭遥测' 29 154 622 41 11 $accent
    $included.BackColor=[Drawing.ColorTranslator]::FromHtml('#E8EFFD');$included.TextAlign='MiddleCenter'
    [void](TextLabel '01   选择客户端' 29 218 620 27 11 $ink)
    $target=New-Object Windows.Forms.ComboBox;$target.DropDownStyle='DropDownList';$target.Location=New-Object Drawing.Point(29,251);$target.Size=New-Object Drawing.Size(622,32)
    [void]$target.Items.AddRange(@('一键配置 · 桌面端与 CLI','仅配置桌面端','仅配置 CLI','恢复上一次配置'));$target.SelectedIndex=0;$form.Controls.Add($target)
    [void](TextLabel '02   导入接入资料' 29 302 420 27 11 $ink)
    $import=New-Object Windows.Forms.Button;$import.Text='选择 TXT 文件';$import.Location=New-Object Drawing.Point(481,296);$import.Size=New-Object Drawing.Size(170,34);$import.FlatStyle='Flat';$import.ForeColor=$accent;$import.BackColor=[Drawing.Color]::White;$form.Controls.Add($import)
    [void](TextLabel 'Gateway API key' 29 343 295 24 9 $muted)
    [void](TextLabel '安装识别码' 356 343 295 24 9 $muted)
    $key=New-Object Windows.Forms.TextBox;$key.UseSystemPasswordChar=$true;$key.Location=New-Object Drawing.Point(29,372);$key.Size=New-Object Drawing.Size(295,29);$form.Controls.Add($key)
    $device=New-Object Windows.Forms.TextBox;$device.Location=New-Object Drawing.Point(356,372);$device.Size=New-Object Drawing.Size(295,29);$form.Controls.Add($device)
    $status=TextLabel '自动备份原配置，保留项目文件、记忆和历史记录。' 29 426 622 45 10 $muted
    [void](TextLabel '开始前，请保存任务并完全退出 Claude。' 29 510 405 38 9 $muted)
    $apply=New-Object Windows.Forms.Button;$apply.Text='开始配置  →';$apply.Location=New-Object Drawing.Point(481,500);$apply.Size=New-Object Drawing.Size(170,46);$apply.FlatStyle='Flat';$apply.FlatAppearance.BorderSize=0;$apply.BackColor=$accent;$apply.ForeColor=[Drawing.Color]::White;$form.Controls.Add($apply);$form.AcceptButton=$apply
    $import.Add_Click({
        try { $pick=New-Object Windows.Forms.OpenFileDialog;$pick.Filter='客户接入资料 (*.txt)|*.txt';if($pick.ShowDialog() -eq 'OK'){$creds=Read-KiviCredentialsText (Read-KiviFile $pick.FileName);$key.Text=$creds.key;$device.Text=$creds.id;$status.Text='接入资料已读取。点击开始，完成全部配置。'} }
        catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'无法读取资料') }
    })
    $target.Add_SelectedIndexChanged({
        $restoring=$target.SelectedIndex -eq 3;$key.Enabled=!$restoring;$device.Enabled=!$restoring;$import.Enabled=!$restoring
        if($restoring){$apply.Text='恢复配置';$status.Text='撤销最近一次配置；如有后续修改，会先停止以保护你的更改。'}
        else{$apply.Text='开始配置  →';$status.Text='自动备份原配置，保留项目文件、记忆和历史记录。'}
    })
    $apply.Add_Click({
        $apply.Enabled=$false;$import.Enabled=$false;$target.Enabled=$false
        try {
            $selected=@('both','desktop','cli','both')[$target.SelectedIndex]
            if ($env:CLAUDE_CONFIG_DIR -or $env:CLAUDE_USER_DATA_DIR) { throw '检测到自定义配置目录，请联系服务方适配该位置。' }
            if (@(Get-Process -Name Claude -ErrorAction SilentlyContinue).Count) { throw '桌面与 CLI 共用部分配置。请先保存任务，退出 Claude 并结束 CLI 会话，再运行工具。' }
            if ($selected -ne 'cli') { foreach($hive in @('HKLM:\SOFTWARE\Policies\Claude','HKCU:\SOFTWARE\Policies\Claude')) { if((Test-Path $hive) -and (Get-Item $hive).GetValueNames().Count){throw '此电脑有 Claude 管理配置，请联系管理员；工具不会覆盖它。'} } }
            if ($selected -ne 'desktop') {
                if (Test-Path (Join-Path $env:ProgramFiles 'ClaudeCode\managed-settings.json')) { throw 'CLI 已有管理策略，请联系管理员确认接入方式。' }
                foreach($hive in @('HKLM:\SOFTWARE\Policies\ClaudeCode','HKCU:\SOFTWARE\Policies\ClaudeCode')) { if(Test-Path $hive){throw 'CLI 已有管理策略，请联系管理员确认接入方式。'} }
            }
            $paths=@{desktop=(Join-Path $env:LOCALAPPDATA 'Claude-3p\configLibrary');cli=(Join-Path $env:USERPROFILE '.claude\settings.json');mcp=(Join-Path $env:USERPROFILE '.claude.json')}
            $paths.desktopMode=Join-Path $env:LOCALAPPDATA 'Claude-3p\claude_desktop_config.json'
            $paths.desktopStartup=$true
            if ($selected -ne 'cli' -and !(Test-Path (Join-Path $env:LOCALAPPDATA 'Claude-3p')) -and (Test-Path (Join-Path $env:APPDATA 'Claude-3p'))) { throw '检测到旧版桌面数据目录。请先启动更新后的官方 Claude 完成原数据迁移，退出后再配置。' }
            $backups=Join-Path $env:LOCALAPPDATA 'KividasSetup\backups'
            if ($target.SelectedIndex -eq 3) {
                $pending=@(Get-ChildItem -LiteralPath $backups -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Where-Object { $m=Read-KiviJson (Read-KiviFile $_.FullName) '备份'; $m.status -eq 'applied' -and !$m.restored })
                if (!$pending.Count) { throw '没有可以恢复的备份。' }
                Restore-KiviBackup $pending[0].FullName $paths
                [void][Windows.Forms.MessageBox]::Show('已恢复上一次配置，请重新打开对应客户端。','配置已恢复');$form.Close();return
            }
            $creds=Test-KiviCredentials $key.Text $device.Text
            $status.Text='正在验证连接，请稍候…';$form.Refresh()
            if (!(Test-KiviRemoteMcp $creds.key)) { throw 'Key 无效或订阅暂不可用。原配置未修改。' }
            $changes=New-KiviPlan $paths $selected $creds
            $backup=Join-Path $backups ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fff')+'-'+[guid]::NewGuid().ToString()+'.json')
            $status.Text='正在备份并写入配置…';$form.Refresh()
            $changed=Save-KiviPlan $changes $backup
            $message='已完成接入初始化、用量 MCP 配置，并关闭遥测与错误上报。原配置已自动备份。';if(!$changed){$message='配置已经一致，无需重复写入。'}
            $message+="`n`n重新打开 Claude，并新建会话。桌面首次可能需要 Continue；仍在个人账号模式时，请切换到网关。`nCLI 可用 /status 检查连接，再发送一条消息。`n`n项目文件、记忆、历史记录和原权限规则均保留。需要撤销时，运行本工具并选择「恢复上一次配置」。"
            [void][Windows.Forms.MessageBox]::Show($message,'配置已完成');$form.Close()
        } catch { $status.Text='配置未完成，详细原因见提示。';[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'未完成配置') }
        finally { $apply.Enabled=$true;$target.Enabled=$true;$import.Enabled=$target.SelectedIndex -ne 3 }
    })
    [void]$form.ShowDialog()
}
if (!$LibraryOnly) {
    if ($PrivacyOnly -or $RestorePrivacy) {
        try { Write-Host (Invoke-KiviPrivacyUpdate -Restore:$RestorePrivacy);exit 0 }
        catch { Write-Host ('未完成：'+$_.Exception.Message);exit 1 }
    }
    Start-KiviSetup
}
