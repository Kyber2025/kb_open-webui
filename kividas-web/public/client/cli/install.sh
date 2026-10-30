#!/bin/sh
# Kividas CLI installer for macOS and Linux.
#   curl -fsSL https://dl.kividas.com/cli/install.sh | sh
# Installs the `kividas` launcher into ~/.kividas/bin (no root, no Node/npm needed);
# the Claude Code binary itself is downloaded by the launcher on first run.
set -eu

BASE="${KIVIDAS_CDN:-https://dl.kividas.com/cli}"
HOME_DIR="${KIVIDAS_HOME:-$HOME/.kividas}"
BIN_DIR="$HOME_DIR/bin"

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) plat="darwin-universal" ;;
  Linux)
    case "$arch" in
      x86_64|amd64) plat="linux-x64" ;;
      aarch64|arm64) plat="linux-arm64" ;;
      *) echo "kividas: unsupported Linux arch: $arch" >&2; exit 1 ;;
    esac ;;
  *) echo "kividas: unsupported OS: $os (Windows: irm https://dl.kividas.com/cli/install.ps1 | iex)" >&2; exit 1 ;;
esac

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "kividas: need curl or wget" >&2; exit 1; fi
}

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t kividas)"
trap 'rm -rf "$tmp"' EXIT
# Plain-text side files (no JSON parsing in sh): the current launcher version and
# a .sha256 next to every artifact. cli/latest.json carries the same data for tools.
fetch "$BASE/launcher-version.txt" "$tmp/version"
ver="$(tr -d '[:space:]' < "$tmp/version")"
[ -n "$ver" ] || { echo "kividas: could not read $BASE/launcher-version.txt" >&2; exit 1; }
url="$BASE/$ver/$plat/kividas"
sha=""
if fetch "$url.sha256" "$tmp/sha" 2>/dev/null; then sha="$(awk '{print $1}' "$tmp/sha")"; fi

echo "kividas: installing launcher $ver ($plat) -> $BIN_DIR/kividas"
mkdir -p "$BIN_DIR"
fetch "$url" "$tmp/kividas"
if [ -n "$sha" ]; then
  got="$( (command -v sha256sum >/dev/null 2>&1 && sha256sum "$tmp/kividas" || shasum -a 256 "$tmp/kividas") | awk '{print $1}')"
  if [ "$got" != "$sha" ]; then echo "kividas: checksum mismatch for $url" >&2; exit 1; fi
fi
chmod 755 "$tmp/kividas"
mv "$tmp/kividas" "$BIN_DIR/kividas"

# PATH: add ~/.kividas/bin to the user's shell rc unless already present.
add_path() { # rcfile
  [ -f "$1" ] || touch "$1"
  if ! grep -qs '\.kividas/bin' "$1"; then
    printf '\n# Kividas CLI\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$1"
    echo "kividas: added $BIN_DIR to PATH in $1"
  fi
}
case "${SHELL:-}" in
  */zsh) add_path "$HOME/.zshrc" ;;
  */bash) add_path "$HOME/.bashrc"; [ "$os" = Darwin ] && add_path "$HOME/.bash_profile" ;;
  */fish) mkdir -p "$HOME/.config/fish/conf.d"; echo "set -gx PATH $BIN_DIR \$PATH" > "$HOME/.config/fish/conf.d/kividas.fish" ;;
  *) add_path "$HOME/.profile" ;;
esac

echo
echo "安装完成。新开一个终端窗口（或 export PATH=\"$BIN_DIR:\$PATH\"），然后："
echo "  kividas login     # 用 proxy.kividas.com 的账号登录"
echo "  kividas           # 进入 Claude Code 终端（首次会下载 Claude Code 本体）"
