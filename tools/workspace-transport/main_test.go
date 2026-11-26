package main

import (
	"bytes"
 "bufio"
 "crypto/ed25519"
 "crypto/rand"
 "errors"
 "sync/atomic"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
 "golang.org/x/crypto/ssh"
)

func TestDirectRequiresPinnedHandshake(t *testing.T) {
 _, private, _ := ed25519.GenerateKey(rand.Reader)
 signer, _ := ssh.NewSignerFromKey(private)
 var credentials atomic.Int32
 cfg := &ssh.ServerConfig{PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions,error) { credentials.Add(1); return nil, errors.New("denied") }}
 cfg.AddHostKey(signer)
 l, err := net.Listen("tcp4", "127.0.0.1:0"); if err != nil { t.Fatal(err) }; defer l.Close()
 go func() { for { c, err := l.Accept(); if err != nil { return }; go func() { defer c.Close(); ssh.NewServerConn(c,cfg) }() } }()
 input := config{Address:l.Addr().String(),Username:"ws_0123456789abcdef",Fingerprint:ssh.FingerprintSHA256(signer.PublicKey())}
 c,err := direct(input,time.Second); if err != nil { t.Fatal(err) }; defer c.Close()
 banner,err := bufio.NewReader(c).ReadString('\n'); if err != nil || !strings.HasPrefix(banner,"SSH-2.0-") { t.Fatal("native connection has no SSH banner") }
 if credentials.Load() != 0 { t.Fatal("probe sent credentials") }
 input.Fingerprint="SHA256:"+strings.Repeat("A",43)
 if c,err := direct(input,time.Second); !errors.Is(err,errHostKey) { if c!=nil {c.Close()};t.Fatal("host mismatch was not fatal") }
}

func TestBannerThenResetIsNotUsable(t *testing.T) {
 l,err := net.Listen("tcp4","127.0.0.1:0");if err!=nil {t.Fatal(err)};defer l.Close()
 go func(){ c,_:=l.Accept();defer c.Close();c.Write([]byte("SSH-2.0-test\r\n")) }()
 if c,err:=direct(config{Address:l.Addr().String()},time.Second);err==nil {c.Close();t.Fatal("banner-only connection selected")}
}

func TestBlockedDirectIsBounded(t *testing.T) {
	l, _ := net.Listen("tcp4", "127.0.0.1:0"); defer l.Close()
	go func() { c, _ := l.Accept(); defer c.Close(); time.Sleep(200*time.Millisecond) }()
	start := time.Now()
	if c, err := direct(config{Address:l.Addr().String()}, 50*time.Millisecond); err == nil { c.Close(); t.Fatal("accepted a silent socket") }
	if time.Since(start) > time.Second { t.Fatal("unbounded direct connection") }
}

func TestTLSBinaryTunnelAndCredentialIsolation(t *testing.T) {
	cfg := config{Username: "ws_0123456789abcdef", Token: strings.Repeat("a", 64)}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer " + cfg.Username + "." + cfg.Token { t.Error("incorrect credential boundary") }
		ws, err := websocket.Accept(w, r, nil); if err != nil { t.Error(err); return }
		defer ws.CloseNow()
		n := websocket.NetConn(context.Background(), ws, websocket.MessageBinary); io.Copy(n, n)
	})); defer server.Close()
	c, err := tunnel(context.Background(), cfg, "wss" + strings.TrimPrefix(server.URL, "https"), server.Client())
	if err != nil { t.Fatal(err) }; defer c.Close()
	payload := bytes.Repeat([]byte{0, 1, 255, 240}, 8000)
	if _, err = c.Write(payload); err != nil { t.Fatal(err) }
	got := make([]byte, len(payload)); if _, err = io.ReadFull(c, got); err != nil { t.Fatal(err) }
	if !bytes.Equal(got, payload) { t.Fatal("binary tunnel changed SSH bytes") }
	// The normal trust store must reject this test's self-signed certificate.
	if c, err := tunnel(context.Background(), cfg, "wss" + strings.TrimPrefix(server.URL, "https"), &http.Client{}); err == nil { c.Close(); t.Fatal("TLS verification bypassed") }
}

func TestDeniedTunnelDoesNotExposeToken(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) })); defer s.Close()
	_, err := tunnel(context.Background(), config{Token: "PRIVATE"}, "ws"+strings.TrimPrefix(s.URL, "http"), s.Client())
	if err == nil || strings.Contains(err.Error(), "PRIVATE") || !strings.Contains(err.Error(), "权限") { t.Fatal("unsafe or missing denial") }
}
