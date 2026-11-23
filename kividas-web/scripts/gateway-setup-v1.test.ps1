param([switch]$RequireWindows)
$ErrorActionPreference='Stop'
if ($RequireWindows -and $env:OS -ne 'Windows_NT') { throw 'Actual Windows host required' }
. (Join-Path $PSScriptRoot 'gateway-setup-v1/windows.ps1') -LibraryOnly
function Assert-Native($Condition,$Message) { if (!$Condition) { throw $Message } }
$temporaryParent=[IO.Path]::GetTempPath()
if ($env:OS -ne 'Windows_NT') { $temporaryParent='/private/tmp' }
$root=Join-Path $temporaryParent ('kividas-native-fixture-'+[guid]::NewGuid())
$creds=@{key=('sk-kiv-desktop-'+('A'*43));id='00000000-0000-4000-8000-000000000001'}
$flag='_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'
$originalEnv=Read-KiviStartupEnv $flag
try {
 $tokens=$null;$errors=$null
 [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'gateway-setup-v1/windows.ps1'),[ref]$tokens,[ref]$errors)
 Assert-Native ($errors.Count -eq 0) 'PowerShell parse failure'
 foreach ($target in @('desktop','cli','both')) {
  $case=Join-Path $root $target
  $paths=@{desktop=(Join-Path $case 'desktop');cli=(Join-Path $case 'cli/settings.json');mcp=(Join-Path $case '.claude.json')}
  $paths.desktopMode=Join-Path $case 'mode.json'
  $paths.desktopStartup=($env:OS -eq 'Windows_NT')
  $originalMode='{"deploymentMode":"1p","keep":true}'
  Write-KiviFile $paths.desktopMode $originalMode
  $original='{"env":{"KEEP":"synthetic","CLAUDE_CODE_PROMPT_CACHE_TTL":"5m","CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL":"5m","CLAUDE_CODE_MESSAGES_PROMPT_CACHE_TTL":"5m","FORCE_PROMPT_CACHING_5M":"1","ANTHROPIC_AUTH_TOKEN":"another-provider"},"promptCacheTtl":"5m","subagentPromptCacheTtl":"5m","permissions":{"allow":["Read"]}}'
  Write-KiviFile $paths.cli $original
  $plan=New-KiviPlan $paths $target $creds
  $backup=Join-Path $case 'backup.json'
  [void](Save-KiviPlan $plan $backup)
  $shared=Read-KiviJson (Read-KiviFile $paths.cli) 'test'
  Assert-Native ($shared.promptCacheTtl -ceq '1h') 'Cache TTL not applied'
  Assert-Native ($shared.env.CLAUDE_CODE_PROMPT_CACHE_TTL -ceq '1h') 'Main env override absent'
  Assert-Native ($shared.env.FORCE_PROMPT_CACHING_5M -ceq '0') 'Force 5m not cleared'
  Assert-Native ($shared.env.CLAUDE_CODE_MESSAGES_PROMPT_CACHE_TTL -ceq '') 'Message override not cleared'
  Assert-Native ($shared.subagentPromptCacheTtl -ceq '5m') 'Existing subagent TTL changed'
  Assert-Native ($shared.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL -ceq '5m') 'Existing subagent env changed'
  Assert-Native ($shared.env.KEEP -ceq 'synthetic') 'Unrelated variable changed'
  if ($target -eq 'desktop') { Assert-Native ($shared.env.ANTHROPIC_AUTH_TOKEN -ceq 'another-provider') 'CLI credential changed' }
  else { Assert-Native ($shared.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL -ceq '1') 'CLI flag absent' }
  if ($target -ne 'cli') {
   Assert-Native ((Read-KiviJson (Read-KiviFile $paths.desktopMode) 'mode').deploymentMode -ceq '3p') 'Desktop mode was not selected'
   if ($paths.desktopStartup) { Assert-Native ((Read-KiviStartupEnv $flag) -ceq '1') 'Desktop launch flag absent' }
   $meta=Read-KiviJson (Read-KiviFile (Join-Path $paths.desktop '_meta.json')) 'meta'
   $profile=Read-KiviJson (Read-KiviFile (Join-Path $paths.desktop ($meta.appliedId+'.json'))) 'profile'
   Assert-Native ($profile.toolSearchEnabled -eq $true) 'Native host ToolSearch setting absent'
  }
  $repeat=New-KiviPlan $paths $target $creds
  Assert-Native ($repeat.Count -eq 0) 'Configuration is not idempotent'
  [void](Restore-KiviBackup $backup $paths)
  Assert-Native ((Read-KiviFile $paths.cli) -ceq $original) 'Original settings not restored'
  Assert-Native ((Read-KiviFile $paths.desktopMode) -ceq $originalMode) 'Original mode not restored'
  Assert-Native ((Read-KiviStartupEnv $flag) -ceq $originalEnv) 'Original user environment not restored'
 }
 foreach ($target in @('desktop','cli','both')) {
  $case=Join-Path $root ('fresh-'+$target)
  $paths=@{desktop=(Join-Path $case 'desktop');cli=(Join-Path $case 'cli/settings.json');mcp=(Join-Path $case '.claude.json')}
  [void](Save-KiviPlan (New-KiviPlan $paths $target $creds) (Join-Path $case 'backup.json'))
  $shared=Read-KiviJson (Read-KiviFile $paths.cli) 'test'
  Assert-Native (!$shared.Contains('subagentPromptCacheTtl')) 'Subagent setting unexpectedly added'
  Assert-Native (!$shared.env.Contains('CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL')) 'Subagent env unexpectedly added'
  Assert-Native ($shared.env.CLAUDE_CODE_PROMPT_CACHE_TTL -ceq '1h') 'New CLI env missing main TTL'
 }
 foreach ($partial in @($false,$true)) {
  & {
   $case=Join-Path $root ('fault-'+$partial)
   $first=Join-Path $case 'settings.json'; $second=Join-Path $case '.claude.json'
   $backup=Join-Path $case 'backup.json'
   Write-KiviFile $first 'original-1'; Write-KiviFile $second 'original-2'
   # Exercise the real writer and rollback. Fail ACL application after the file has changed.
   function Protect-KiviFile($Path) {
    if ($Path -ceq $second -and [IO.File]::ReadAllText($Path) -ceq $creds.key) {
     throw [UnauthorizedAccessException]::new('sensitive-native-details '+$creds.key)
    }
    if ($partial -and $Path -ceq $first -and [IO.File]::ReadAllText($Path) -ceq 'original-1') {
     throw [IO.IOException]::new('sensitive-native-details '+$creds.key,-2147024864)
    }
   }
   $changes=@(@{path=$first;before='original-1';after='changed'},@{path=$second;before='original-2';after=$creds.key})
   $display=''
   try { [void](Save-KiviPlan $changes $backup) } catch { $display=Format-KiviProblem $_ }
   foreach ($detail in @('步骤：写入配置','设置目标文件访问权限',$second,'拒绝访问',$backup)) {
    Assert-Native ($display.Contains($detail)) 'Primary failure missing a diagnostic field'
   }
   Assert-Native (!$display.Contains($creds.key) -and !$display.Contains('sensitive-native-details')) 'Native exception content disclosed'
   $manifest=Read-KiviJson (Read-KiviFile $backup) 'test'
   if ($partial) {
    foreach ($detail in @('部分恢复未完成','步骤：自动恢复原配置',$first,'Windows 32')) {
     Assert-Native ($display.Contains($detail)) 'Rollback failure missing a diagnostic field'
    }
    Assert-Native ($manifest.status -eq 'partial') 'Partial recovery status missing'
   } else {
    Assert-Native ($manifest.status -eq 'rolled_back' -and $display.Contains('本次更改已恢复')) 'Successful rollback not reported'
   }
   Assert-Native ((Read-KiviFile $second) -ceq 'original-2') 'Failed write did not restore contents'
  }
 }
 $badPath=Join-Path $root ($creds.key+'.json')
 Write-KiviFile $badPath ('{"oops":'+$creds.key)
 Set-KiviStage '读取配置并生成写入计划'
 $display=''
 try { [void](Read-KiviJson (Read-KiviFile $badPath) 'CLI settings.json') } catch { $display=Format-KiviProblem $_ }
 Assert-Native ($display.Contains('不是有效 JSON') -and $display.Contains('[已隐藏].json') -and !$display.Contains($creds.key)) 'JSON error with a sensitive path was not sanitized'
 @{passed=9;actualWindows=($env:OS -eq 'Windows_NT');startupEnvironmentTested=($env:OS -eq 'Windows_NT');scope='PowerShell configuration and desktop mode/environment write, idempotence, exact restore, failure diagnostics and credential redaction'} | ConvertTo-Json -Compress
} finally {
 if ($env:OS -eq 'Windows_NT' -and (Read-KiviStartupEnv $flag) -cne $originalEnv) { Write-KiviStartupEnv $flag $originalEnv }
 if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
