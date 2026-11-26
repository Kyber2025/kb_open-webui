// workspace-transport is an OpenSSH ProxyCommand. SSH remains end-to-end:
// this process never holds a device private key or interprets SSH authentication.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/crypto/ssh"
)

const endpoint = "wss://ai.kividas.com/api/workspace-transport/v1/connect"

type config struct {
	Address string `json:"address"`
	Username string `json:"username"`
	Token string `json:"token"`
	Fingerprint string `json:"fingerprint"`
}

func readConfig(path string) (config, error) {
	var c config
	f, err := os.Open(path)
	if err != nil { return c, errors.New("连接配置不存在，请重新运行配置文件") }
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, 4096)); d.DisallowUnknownFields()
	if err = d.Decode(&c); err != nil { return c, errors.New("连接配置无效") }
	var extra any
	if d.Decode(&extra) != io.EOF { return c, errors.New("连接配置无效") }
	host, port, err := net.SplitHostPort(c.Address)
	if err != nil || net.ParseIP(host).To4() == nil || !regexp.MustCompile(`^[1-9][0-9]{0,4}$`).MatchString(port) ||
		!regexp.MustCompile(`^ws_[a-f0-9]{16}$`).MatchString(c.Username) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(c.Token) || !regexp.MustCompile(`^SHA256:[A-Za-z0-9+/]{43}$`).MatchString(c.Fingerprint) {
		return c, errors.New("连接配置无效")
	}
	return c, nil
}

var errHostKey = errors.New("实例指纹不一致，已停止连接")

// Complete an unauthenticated SSH key exchange before selecting native ingress.
// Some proxies permit the banner but reset the following SSH handshake. No
// password, agent or device key is used; the actual OpenSSH stream is never replayed.
func direct(cfg config, timeout time.Duration) (net.Conn, error) {
 probe, err := net.DialTimeout("tcp4", cfg.Address, timeout)
 if err != nil { return nil, err }
 probe.SetDeadline(time.Now().Add(timeout))
 verified := false
 client, _, _, err := ssh.NewClientConn(probe, cfg.Address, &ssh.ClientConfig{
  User: cfg.Username,
  HostKeyAlgorithms: []string{ssh.KeyAlgoED25519},
  HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
   if ssh.FingerprintSHA256(key) != cfg.Fingerprint { return errHostKey }
   verified = true
   return nil
  },
 })
 probe.Close()
 if client != nil { client.Close() }
 if errors.Is(err, errHostKey) { return nil, errHostKey }
 // No authentication methods were supplied. Reaching the server's auth
 // rejection proves the complete encrypted handshake succeeded.
 if !verified || (err != nil && !strings.Contains(err.Error(), "unable to authenticate, attempted methods [none]")) {
  if err == nil { err = errors.New("SSH handshake incomplete") }
  return nil, err
 }
 return net.DialTimeout("tcp4", cfg.Address, timeout)
}

func tunnel(ctx context.Context, c config, url string, client *http.Client) (net.Conn, error) {
	dialCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	w, resp, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{
		HTTPClient: client,
		HTTPHeader: http.Header{"Authorization": {"Bearer " + c.Username + "." + c.Token}, "User-Agent": {"Kividas-SSH-Transport/1.0"}},
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		if resp != nil && (resp.StatusCode == 401 || resp.StatusCode == 403) { return nil, errors.New("连接权限已失效，请检查订阅或重新下载个人 TXT") }
		if resp != nil && resp.StatusCode == 429 { return nil, errors.New("连接尝试过于频繁，请稍后重试") }
		return nil, errors.New("HTTPS 备用入口不可达，请检查网络后重试")
	}
	n := websocket.NetConn(ctx, w, websocket.MessageBinary)
	w.SetReadLimit(64 * 1024)
	return n, nil
}

func transfer(c net.Conn, input io.Reader, output io.Writer) error {
	defer c.Close()
	done := make(chan error, 2)
	go func() { _, err := io.CopyBuffer(c, input, make([]byte, 32*1024)); done <- err }()
	go func() { _, err := io.CopyBuffer(output, c, make([]byte, 32*1024)); done <- err }()
	return <-done
}

func run() error {
	executable, err := os.Executable()
	if err != nil { return err }
	c, err := readConfig(filepath.Join(filepath.Dir(executable), "transport.json"))
	if err != nil { return err }
	// A test/operator-only --https flag can verify the backup even on a healthy
	// direct network. Normal setup and all launchers use automatic selection.
	if len(os.Args) == 1 {
		conn, e := direct(c, 3*time.Second)
		if e == nil { return transfer(conn, os.Stdin, os.Stdout) }
		if errors.Is(e, errHostKey) { return e }
	} else if len(os.Args) != 2 || os.Args[1] != "--https" { return errors.New("不支持的启动参数") }
	client := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			DialContext: (&net.Dialer{Timeout: 8*time.Second, KeepAlive: 30*time.Second}).DialContext,
			TLSHandshakeTimeout: 8*time.Second, ResponseHeaderTimeout: 10*time.Second, ForceAttemptHTTP2: false},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	conn, err := tunnel(context.Background(), c, endpoint, client)
	if err != nil { return err }
	return transfer(conn, os.Stdin, os.Stdout)
}

func main() {
	if err := run(); err != nil { fmt.Fprintln(os.Stderr, "连接未完成：" + err.Error()); os.Exit(1) }
}
