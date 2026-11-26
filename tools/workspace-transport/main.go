// workspace-transport is an OpenSSH ProxyCommand. SSH remains end-to-end:
// this process never holds a device private key or interprets SSH authentication.
package main

import (
	"bufio"
	"bytes"
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
)

const endpoint = "wss://ai.kividas.com/api/workspace-transport/v1/connect"

type config struct {
	Address string `json:"address"`
	Username string `json:"username"`
	Token string `json:"token"`
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
		!regexp.MustCompile(`^ws_[a-f0-9]{16}$`).MatchString(c.Username) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(c.Token) {
		return c, errors.New("连接配置无效")
	}
	return c, nil
}

type bufferedConn struct { net.Conn; reader *bufio.Reader }
func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// Read only the identification banner. Nothing from stdin (including SSH
// authentication) is sent until one transport is selected. Never replay data.
func direct(address string, timeout time.Duration) (net.Conn, error) {
	c, err := net.DialTimeout("tcp4", address, timeout)
	if err != nil { return nil, err }
	c.SetDeadline(time.Now().Add(timeout))
	r := bufio.NewReaderSize(c, 8192)
	var banner bytes.Buffer
	for banner.Len() < 8192 {
		line, e := r.ReadSlice('\n')
		if e != nil { err = e; break }
		banner.Write(line)
		if strings.HasPrefix(string(line), "SSH-2.0-") {
			c.SetDeadline(time.Time{})
			return &bufferedConn{c, bufio.NewReader(io.MultiReader(bytes.NewReader(banner.Bytes()), r))}, nil
		}
	}
	c.Close()
	if err == nil { err = errors.New("SSH banner missing") }
	return nil, err
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
		conn, e := direct(c.Address, 3*time.Second)
		if e == nil { return transfer(conn, os.Stdin, os.Stdout) }
		fmt.Fprintln(os.Stderr, "直连暂不可用，正在尝试 HTTPS 备用入口…")
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
