import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scratch = mkdtempSync(join(tmpdir(), 'workspace-launcher-'))
const run = (cmd, args, options={}) => {
  const r = spawnSync(cmd,args,{encoding:'utf8',...options})
  assert.equal(r.status,0,`${cmd} failed: ${r.stderr}`)
  return r.stdout
}
try {
  run('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(scratch,'host-key')])
  const fingerprint=run('ssh-keygen',['-lf',join(scratch,'host-key.pub'),'-E','sha256']).split(/\s+/)[1]
  const workspace={name:'ssh02',host:'192.0.2.12',port:2222,username:'workspace',instanceId:'i-test',directory:'/workspace/claude',fingerprint}
  const username='ws_0123456789abcdef'
  const unix={filename:'kividas-ssh-setup.sh',content:readFileSync('../backend/open_webui/resources/workspace/kividas-ssh-setup.sh','utf8')}
  const windows={filename:'kividas-ssh-setup.ps1',content:readFileSync('../backend/open_webui/resources/workspace/kividas-ssh-setup.ps1','utf8')}
  const password='A'.repeat(32)
  const material = (overrides={}) => Object.entries({KIVIDAS_SSH_CONFIG:'1',SSH_NAME:workspace.name,SSH_URL:`ssh://${username}@${workspace.host}:${workspace.port}`,SSH_FINGERPRINT:fingerprint,SSH_PASSWORD:password,SSH_DIRECTORY:workspace.directory,...overrides}).map(([k,v])=>`${k}=${v}`).join('\n')+'\n'
  const txt=join(scratch,'connection file 中文.txt');writeFileSync(txt,material())
  assert(!/__(?:HOST|PORT|USER|NAME|FINGERPRINT)__/.test(unix.content+windows.content))
  assert(!unix.content.includes('StrictHostKeyChecking no'))
  const setup=join(scratch,unix.filename);writeFileSync(setup,unix.content)
  run('bash',['-n',setup])
  const bin=join(scratch,'bin');mkdirSync(bin)
  const home=join(scratch,"client space 中文 ' %");mkdirSync(home)
  writeFileSync(join(home,'.bashrc'),'# existing bash config\nexport KEEP_ME=unchanged\n')
  writeFileSync(join(home,'.profile'),'# existing login config\n')
  const record=join(scratch,'calls.jsonl'),enrolled=join(scratch,'enrolled')
  const hostLine=`[${workspace.host}]:${workspace.port} ${readFileSync(join(scratch,'host-key.pub'),'utf8')}`
  writeFileSync(join(bin,'curl'),`#!${process.execPath}\nimport fs from 'node:fs'; const a=process.argv.slice(2); const platform=a.find(x=>x.startsWith('https://')).split('/').at(-1); fs.copyFileSync(${JSON.stringify(resolve('../backend/open_webui/resources/workspace/transport'))}+'/'+platform,a[a.indexOf('-o')+1]);\n`,{mode:0o755})
  writeFileSync(join(bin,'ssh-keyscan'),`#!/bin/sh\nprintf '%s\\n' '${hostLine.trim()}'\n`,{mode:0o755})
  writeFileSync(join(bin,'ssh'),`#!${process.execPath}\nimport fs from 'node:fs';import cp from 'node:child_process';
const a=process.argv.slice(2);if(a.includes('PreferredAuthentications=none')){const k=a.find(x=>x.startsWith('UserKnownHostsFile=')).slice(19).slice(1,-1).replaceAll('%%','%');fs.writeFileSync(k,${JSON.stringify(hostLine)});process.exit(255)};fs.appendFileSync(${JSON.stringify(record)},JSON.stringify(a)+'\\n');
if(a.includes('PubkeyAuthentication=no')){const pass=cp.spawnSync(process.env.SSH_ASKPASS,[],{encoding:'utf8'}).stdout.trim();if(pass!=='A'.repeat(32))process.exit(4);const key=fs.readFileSync(0,'utf8');if(!key.startsWith('ssh-ed25519 '))process.exit(2);fs.writeFileSync(${JSON.stringify(enrolled)},key);process.exit(0)}
if(!fs.existsSync(${JSON.stringify(enrolled)}))process.exit(255);
const remote=a.at(-1);if(remote.startsWith('cd /workspace/claude && exec /usr/local/bin/workspace-session claude')) {const r=cp.spawnSync('bash',['-c',remote.replace('cd /workspace/claude && exec /usr/local/bin/workspace-session claude', 'exec claude')],{stdio:'inherit'});process.exit(r.status)}
`,{mode:0o755})
  writeFileSync(join(bin,'claude'),`#!${process.execPath}\nif(process.argv.includes('--probe-exit'))process.exit(37);process.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,{mode:0o755})
  writeFileSync(join(bin,'sftp'),`#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,{mode:0o755})
  const env={...process.env,PATH:bin+':'+process.env.PATH,KIVIDAS_CLIENT_HOME:home}
  run('bash',[setup,txt],{env})
  run('bash',[setup,txt],{env})
  run('/bin/bash',[setup],{env,input:txt.replaceAll(' ','\\ ')+' \n'})
  const calls=readFileSync(record,'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(calls.filter(a=>a.includes('PubkeyAuthentication=no')).length,1,'Repeat setup should reuse the enrolled key')
  assert(!existsSync(join(home,'.bash_profile')),'Do not shadow an existing .profile')
  assert(readFileSync(join(home,'.bashrc'),'utf8').includes('export KEEP_ME=unchanged'))
  assert.equal((readFileSync(join(home,'.bashrc'),'utf8').match(/BEGIN KIVIDAS CLAUDE/g)||[]).length,1)
  const incomplete='# custom config\n# BEGIN KIVIDAS CLAUDE\nexport PRESERVE_TAIL=yes\n'
  writeFileSync(join(home,'.zshrc'),incomplete)
  run('bash',[setup,txt],{env})
  assert.equal(readFileSync(join(home,'.zshrc'),'utf8'),incomplete,'Do not discard content after an incomplete managed block')
  const launch=join(home,'.kividas/ssh/ssh02-'+username,'launch.sh')
  const args=['-p','中文 with spaces',"quote'\"",'$(touch /tmp/no-launcher-injection)','a; echo unexpected','line\nbreak','*','']
  assert.deepEqual(JSON.parse(run('bash',[launch,'claude',...args],{env})),args)
  assert.deepEqual(JSON.parse(run('bash',[launch,'sftp','-b','file with spaces'],{env})).slice(-3),['-b','file with spaces','workspace'])
  const profileCall=run('bash',['-c',`. "$1"; claude --version`,'test',join(home,'.kividas/claude-functions.sh')],{env})
  assert.deepEqual(JSON.parse(profileCall),['--version'])
  assert.equal(spawnSync('bash',[launch,'claude','--probe-exit'],{env}).status,37,'Preserve the remote command exit status through the Mac sleep assertion')
  writeFileSync(join(bin,'uname'),"#!/bin/sh\nprintf 'Linux\\n'\n",{mode:0o755})
  assert.deepEqual(JSON.parse(run('bash',[launch,'claude',...args],{env})),args,'Linux launch remains direct')
  rmSync(join(bin,'uname'))
  rmSync(enrolled)
  const wrongHost=join(scratch,'wrong-host.txt');writeFileSync(wrongHost,material({SSH_FINGERPRINT:'SHA256:'+'A'.repeat(43)}))
  const before=readFileSync(record,'utf8')
  const bad=spawnSync('bash',[setup,wrongHost],{env,encoding:'utf8'})
  assert.notEqual(bad.status,0)
  assert.equal(readFileSync(record,'utf8'),before,'Host mismatch must stop before any authentication')
  for (const change of [{SSH_URL:'ssh://'+username+'@127.0.0.1;touch /tmp/injection:2222'}, {SSH_NAME:'$(touch /tmp/injection)'}, {SSH_FINGERPRINT:'bad'}, {SSH_PASSWORD:'bad'}, {SSH_DIRECTORY:'/etc'}, {BAD:'1'}, {SSH_URL:'ssh://'+username+'@999.1.1.1:22'}]) {
    writeFileSync(txt,material(change));assert.notEqual(spawnSync('bash',[setup,txt],{env}).status,0)
    assert.equal(readFileSync(record,'utf8'),before,'Invalid TXT must stop before authentication')
  }
  writeFileSync(txt,material()+'SSH_NAME=ssh03\n');assert.notEqual(spawnSync('bash',[setup,txt],{env}).status,0)
  assert.equal(readFileSync(record,'utf8'),before)
  assert(!readFileSync(join(home,'.kividas/ssh/ssh02-'+username,'config'),'utf8').includes(password))
  assert(!readFileSync(join(home,'.kividas/claude-functions.sh'),'utf8').includes(password))
  if(process.env.KIVIDAS_PS_OUTPUT) writeFileSync(process.env.KIVIDAS_PS_OUTPUT,windows.content)
  if(process.env.KIVIDAS_PWSH) {
    const psSetup=join(scratch,'setup.ps1');writeFileSync(psSetup,windows.content)
    const launcher=windows.content.match(/\$Launcher = @'\r?\n([\s\S]*?)\r?\n'@/)[1]
    const psLaunch=join(scratch,'launch.ps1');writeFileSync(psLaunch,launcher)
    const psCalls=join(scratch,'powershell-call.json')
    const psTest=join(scratch,'test.ps1')
    writeFileSync(psTest,`$ErrorActionPreference = 'Stop'
foreach ($File in @($env:TEST_SETUP, $env:TEST_LAUNCH)) {
  $Tokens = $null; $Errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$Tokens, [ref]$Errors)
  if ($Errors.Count) { throw ($Errors | Out-String) }
}
function ssh.exe {
  [IO.File]::WriteAllText($env:TEST_OUTPUT, (ConvertTo-Json -InputObject @($args) -Compress))
  $global:LASTEXITCODE = 0
}
$Argv = @(ConvertFrom-Json $env:TEST_ARGS)
& $env:TEST_LAUNCH claude @Argv
`)
    const psEnv={...process.env,TEST_SETUP:psSetup,TEST_LAUNCH:psLaunch,TEST_OUTPUT:psCalls,TEST_ARGS:JSON.stringify(args)}
    run(process.env.KIVIDAS_PWSH,['-NoLogo','-NoProfile','-File',psTest],{env:psEnv})
    const remote=JSON.parse(readFileSync(psCalls,'utf8')).at(-1)
    assert.deepEqual(JSON.parse(Buffer.from(remote.split(' ').at(-1),'base64').toString('utf8')),['/usr/local/bin/workspace-session','claude',...args])
    psEnv.TEST_ARGS='[]'
    run(process.env.KIVIDAS_PWSH,['-NoLogo','-NoProfile','-File',psTest],{env:psEnv})
    const bareRemote=JSON.parse(readFileSync(psCalls,'utf8')).at(-1)
    assert.deepEqual(JSON.parse(Buffer.from(bareRemote.split(' ').at(-1),'base64').toString('utf8')),['/usr/local/bin/workspace-session','claude'])
    console.log('PASS: PowerShell setup/launcher syntax and lossless argument encoding, including an empty argument list')
  }
  console.log('PASS: enrollment, repeat setup, profile preservation, host pinning, shell argument safety, SFTP launcher and invalid inputs')
} finally {rmSync(scratch,{recursive:true,force:true})}
