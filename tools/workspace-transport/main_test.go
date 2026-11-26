package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestDirectPreservesBannerAndBytes(t *testing.T) {
	l, err := net.Listen("tcp4", "127.0.0.1:0"); if err != nil { t.Fatal(err) }; defer l.Close()
	go func() { c, _ := l.Accept(); defer c.Close(); c.Write([]byte("SSH-2.0-test\r\n\x00\xff")); io.Copy(c, c) }()
	c, err := direct(l.Addr().String(), time.Second); if err != nil { t.Fatal(err) }; defer c.Close()
	got := make([]byte, 16); if _, err := io.ReadFull(c, got); err != nil { t.Fatal(err) }
	if !bytes.Equal(got, []byte("SSH-2.0-test\r\n\x00\xff")) { t.Fatalf("lost bytes: %q", got) }
}

func TestBlockedDirectIsBounded(t *testing.T) {
	l, _ := net.Listen("tcp4", "127.0.0.1:0"); defer l.Close()
	go func() { c, _ := l.Accept(); defer c.Close(); time.Sleep(200*time.Millisecond) }()
	start := time.Now()
	if c, err := direct(l.Addr().String(), 50*time.Millisecond); err == nil { c.Close(); t.Fatal("accepted a silent socket") }
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
