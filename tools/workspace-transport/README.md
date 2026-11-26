# SSH transport helper

OpenSSH `ProxyCommand` for the existing workspace launchers. It selects a direct
SSH connection when a banner arrives within a bounded timeout, otherwise opens
an authenticated TLS WebSocket to the existing `ai.kividas.com` gateway. Native
OpenSSH still checks the TXT host fingerprint and authenticates the device key.
It never retries after forwarding SSH bytes or after a host-key/login rejection.

`transport.json` is private to the user's installation and contains only the
workspace address, username and a transport-only derived credential. The original
password is not persisted by the installer. The gateway checks the current
binding and subscription on admission and every ten seconds thereafter.

Build with Go 1.27.4, `CGO_ENABLED=0`; the module dependency is pinned in `go.sum`.
Run `go test ./...`, then `python3 build.py`. The build script emits six binaries
to `backend/open_webui/resources/workspace/transport/` (ignored build artifacts),
writes `manifest.json`, and pins those hashes in the installers. Release packaging
must verify the manifest and include all six artifacts in the backend image.
The public binary download endpoint carries no customer data. Setup scripts and
personal TXT downloads continue to require a live owner binding.

`--https` forces the backup path for operator acceptance tests; normal installed
shortcuts automatically select a path on each connection. Tests cover a silent
direct socket, byte preservation, self-signed TLS rejection and denial messages.
Native SSH/SFTP, Windows 5.1/7, long idle and binding revocation are separate live
acceptance checks. Never use `InsecureSkipVerify` or relax SSH host pinning.
