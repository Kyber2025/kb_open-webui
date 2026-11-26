#!/bin/bash
set -euo pipefail
umask 077
# Personal TXT is data only: never source or evaluate it.
accent='' reset='' dim=''
if test -t 1; then accent=$'\033[38;5;141m'; reset=$'\033[0m'; dim=$'\033[2m'; fi
printf '\n%s  KIVIDAS  /  SSH WORKSPACE%s\n' "$accent" "$reset"
printf '  配置一次，以后输入 claude 即可连接\n  ────────────────────────────────────────────\n\n'
step() { printf '\n%s  %s%s  %s\n' "$accent" "$1" "$reset" "$2"; }
fail() { printf '\n  配置未完成：%s\n  请检查连接资料或参考下载的使用教程。\n' "$1" >&2; exit 1; }
step '[1/4]' '导入个人连接 TXT'
config=${1:-}
if test -z "$config"; then printf '  将个人连接 TXT 拖入终端，按回车：'; IFS= read -r config; fi
# Terminal may append a space after a dragged path. Preserve literal filenames
# that already exist, and otherwise remove the drag-and-drop trailing whitespace.
if ! test -f "$config"; then config="${config%"${config##*[!$' \t']}"}"; fi
# Finder drag-and-drop escapes spaces; strip only known path escaping, never eval.
config=${config#\'}; config=${config%\'}; config=${config#\"}; config=${config%\"}
config=${config//\\ / }; config=${config//\\(/(}; config=${config//\\)/)}
test -f "$config" && test ! -L "$config" || fail '找不到 TXT 文件。'
test "$(wc -c < "$config")" -le 8192 || fail 'TXT 文件过大。'
version='' name='' url='' expected='' password='' directory=''; seen='|'
while IFS= read -r line || test -n "$line"; do
  line=${line%$'\r'}
  case "$line" in ''|\#*) continue ;; esac
  key=${line%%=*}; value=${line#*=}
  test "$key" != "$line" || fail 'TXT 格式不正确。'
  case "$seen" in *"|$key|"*) fail 'TXT 有重复字段。' ;; esac
  seen="$seen$key|"
  case "$key" in
    KIVIDAS_SSH_CONFIG) version=$value ;; SSH_NAME) name=$value ;; SSH_URL) url=$value ;;
    SSH_FINGERPRINT) expected=$value ;; SSH_PASSWORD) password=$value ;; SSH_DIRECTORY) directory=$value ;;
    *) fail 'TXT 包含未知字段，请重新下载。' ;;
  esac
done < "$config"
[[ "$version" = 1 && "$name" =~ ^ssh[0-9]{2}$ && "$directory" = /workspace/claude ]] || fail '连接资料版本或工作区无效。'
[[ "$url" =~ ^ssh://(ws_[a-f0-9]{16})@([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):([0-9]{1,5})$ ]] || fail 'SSH URL 无效。'
user=${BASH_REMATCH[1]}; host=${BASH_REMATCH[2]}; port=${BASH_REMATCH[3]}
for octet in ${host//./ }; do ((10#$octet <= 255)) || fail '实例地址无效。'; done
((10#$port > 0 && 10#$port <= 65535)) || fail '端口无效。'
[[ "$expected" =~ ^SHA256:[A-Za-z0-9+/]{43}$ && "$password" =~ ^[A-Za-z0-9_-]{32}$ ]] || fail '指纹或连接密码无效。'
printf '  已选择 %s · %s:%s\n' "$name" "$host" "$port"
step '[2/4]' '验证实例指纹与连接'
client_home="${KIVIDAS_CLIENT_HOME:-$HOME}"
root="$client_home/.kividas"
base="$root/ssh/$name-$user"
for tool in ssh sftp ssh-keygen ssh-keyscan; do
  command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }
done
for directory in "$root" "$root/ssh" "$base"; do
  test ! -L "$directory" || { echo 'Refusing a symbolic-link installation directory.' >&2; exit 1; }
  mkdir -p "$directory"
  chmod 700 "$directory"
done
for file in id_ed25519 id_ed25519.pub known_hosts config launch.sh; do
  test ! -L "$base/$file" || { echo 'Refusing a symbolic-link configuration file.' >&2; exit 1; }
done
scan=$(mktemp "$base/.host-key.XXXXXXXX")
secret_dir=''
trap 'rm -f -- "$scan"; if test -n "$secret_dir"; then rm -rf -- "$secret_dir"; fi' EXIT
ssh-keyscan -T 10 -p "$port" -t ed25519 "$host" >"$scan" 2>/dev/null
actual=$(ssh-keygen -lf "$scan" -E sha256 | awk '{print $2}')
test "$actual" = "$expected" || { echo 'Server fingerprint mismatch. Setup stopped.' >&2; exit 1; }
mv -f -- "$scan" "$base/known_hosts"
if ! test -f "$base/id_ed25519"; then
  ssh-keygen -q -t ed25519 -N '' -C 'kividas-workspace-client' -f "$base/id_ed25519"
fi
ssh-keygen -y -f "$base/id_ed25519" >"$base/id_ed25519.pub"
chmod 600 "$base/id_ed25519" "$base/id_ed25519.pub" "$base/known_hosts"
# The dedicated config does not edit the customer's existing SSH configuration.
# Escape local path characters interpreted inside an OpenSSH quoted value.
config_base=${base//\\/\\\\}
config_base=${config_base//\"/\\\"}
config_base=${config_base//%/%%}
cat >"$base/config" <<CONFIG
Host workspace
  HostName $host
  Port $port
  User $user
  IdentityFile "$config_base/id_ed25519"
  UserKnownHostsFile "$config_base/known_hosts"
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  HostKeyAlgorithms ssh-ed25519
  IdentitiesOnly yes
  ServerAliveInterval 30
  ServerAliveCountMax 10
  ConnectTimeout 15
  ForwardAgent no
  ClearAllForwardings yes
CONFIG
step '[3/4]' '配置本机免密密钥'
# Re-running setup with this already-enrolled key does not ask for a password.
if ! ssh -F "$base/config" -o BatchMode=yes workspace true 2>/dev/null; then
  secret_dir=$(mktemp -d "$base/.enroll.XXXXXXXX")
  printf '%s\n' "$password" > "$secret_dir/password"
  cat > "$secret_dir/askpass" <<'ASKPASS'
#!/bin/sh
cat -- "$(dirname -- "$0")/password"
ASKPASS
  chmod 700 "$secret_dir/askpass"
  export SSH_ASKPASS="$secret_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=kividas-setup:0
  ssh -F "$base/config" -o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 workspace \
    'set -eu; cd /workspace/claude; umask 077; test ! -L .ssh; mkdir -p .ssh; test ! -L .ssh/authorized_keys; touch .ssh/authorized_keys; chmod 700 .ssh; chmod 600 .ssh/authorized_keys; IFS= read -r key; case "$key" in "ssh-ed25519 "*) ;; *) exit 1;; esac; line="restrict,pty $key"; grep -qxF -- "$line" .ssh/authorized_keys || printf "%s\n" "$line" >> .ssh/authorized_keys' <"$base/id_ed25519.pub" || fail '登录失败。订阅到期或绑定变更后请重新下载 TXT。'
  rm -rf -- "$secret_dir"; secret_dir=''
  unset SSH_ASKPASS SSH_ASKPASS_REQUIRE DISPLAY
fi
unset password
ssh -F "$base/config" -o BatchMode=yes workspace true || { echo 'Key sign-in failed. Shortcuts were not installed.' >&2; exit 1; }
step '[4/4]' '安装 claude / SSH / SFTP 快捷命令'
cat >"$base/launch.sh" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mode=${1:-claude}
shift || true
run_connection() {
  # Hold an idle-sleep assertion only for this connection. The display may sleep;
  # closing the connection releases the assertion without changing power settings.
  if test "$(uname -s)" = Darwin && test -x /usr/bin/caffeinate; then
    exec /usr/bin/caffeinate -i "$@"
  fi
  exec "$@"
}
case "$mode" in
  shell) run_connection ssh -F "$base/config" -o BatchMode=yes -t workspace "$@" ;;
  sftp) run_connection sftp -F "$base/config" -o BatchMode=yes "$@" workspace ;;
  claude)
    remote='cd /workspace/claude && exec /usr/local/bin/workspace-session claude'
    for argument in "$@"; do
      escaped=${argument//\'/\'\\\'\'}
      remote+=" '$escaped'"
    done
    tty_flag=-T
    if test -t 0 && test -t 1; then tty_flag=-t; fi
    run_connection ssh -F "$base/config" -o BatchMode=yes "$tty_flag" workspace "$remote"
    ;;
  *) echo 'Unknown launch mode.' >&2; exit 1 ;;
esac
LAUNCH
chmod 700 "$base/launch.sh"
# Only the named managed block is replaced; other shell customizations remain.
functions="$root/claude-functions.sh"
test ! -L "$functions" || { echo 'Refusing a symbolic-link functions file.' >&2; exit 1; }
launch_path="'${base//\'/\'\\\'\'}/launch.sh'"
{
  printf 'claude() { %s claude "$@"; }\n' "$launch_path"
  printf 'claude-ssh() { %s shell "$@"; }\n' "$launch_path"
  printf 'claude-sftp() { %s sftp "$@"; }\n' "$launch_path"
} >"$functions"
functions_path="'${functions//\'/\'\\\'\'}'"
login_profile="$client_home/.bash_profile"
if ! test -e "$login_profile"; then
  if test -e "$client_home/.bash_login"; then login_profile="$client_home/.bash_login"
  elif test -e "$client_home/.profile"; then login_profile="$client_home/.profile"
  fi
fi
for profile in "$client_home/.zshrc" "$client_home/.bashrc" "$login_profile"; do
  test ! -L "$profile" || { echo "Profile is a symbolic link; add this manually: source $functions_path"; continue; }
  if test -e "$profile"; then
    if ! LC_ALL=C awk '/^# BEGIN KIVIDAS CLAUDE$/{if (inside) bad=1;inside=1} /^# END KIVIDAS CLAUDE$/{if (!inside) bad=1;inside=0} END{exit (bad || inside)}' "$profile"; then
      echo "Profile has an incomplete managed block; add this manually: source $functions_path"
      continue
    fi
    backup=$(mktemp "$profile.kividas-backup.XXXXXXXX")
    cp -p -- "$profile" "$backup"
  fi
  temp=$(mktemp "$profile.kividas.XXXXXXXX")
  if test -f "$profile"; then
    LC_ALL=C awk '/^# BEGIN KIVIDAS CLAUDE$/{skip=1;next} /^# END KIVIDAS CLAUDE$/{skip=0;next} !skip{print}' "$profile" >"$temp"
  fi
  printf '\n# BEGIN KIVIDAS CLAUDE\n. %s\n# END KIVIDAS CLAUDE\n' "$functions_path" >>"$temp"
  mv -f -- "$temp" "$profile"
done
printf '\n%s  ✓ 配置完成%s\n  打开新终端，输入 claude 启动或恢复会话。\n  远程终端：claude-ssh    文件传输：claude-sftp\n' "$accent" "$reset"
printf 'For this terminal, run: source %s\n' "$functions_path"
echo 'Claude now runs on the remote workspace. Removing the user binding revokes this key.'
if test "$(uname -s)" = Darwin; then
  echo 'Mac: automatic system sleep is prevented while a shortcut connection is open. The display may still sleep.'
fi

echo '个人 TXT 含 SSH 密码，请妥善保存。到期自动解绑并清空文件，请提前备份。'
