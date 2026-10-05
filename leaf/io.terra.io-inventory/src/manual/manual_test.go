package manual

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

func rtspRequest(address string) Request {
	return Request{Kind: "camera", Name: "Front door", AdapterID: "manual.rtsp", Address: address}
}

func TestAdmitTakesWhatAnAdapterCanOpen(t *testing.T) {
	adapters := DefaultAdapters()
	entry, adapter, err := adapters.Admit(rtspRequest("rtsp://admin:secret@192.168.0.40:554/stream1"), time.Now())
	if err != nil {
		t.Fatalf("admit: %v", err)
	}
	if adapter.ID() != "manual.rtsp" || entry.AdapterID != "manual.rtsp" {
		t.Errorf("adapter = %s / %s, want manual.rtsp", adapter.ID(), entry.AdapterID)
	}
	if entry.Kind != inventory.DeviceCamera {
		t.Errorf("kind = %s, want camera", entry.Kind)
	}
	if len(entry.Capabilities) != 1 || entry.Capabilities[0] != "video.frame" {
		t.Errorf("capabilities = %v, want the adapter's [video.frame] when none are named", entry.Capabilities)
	}
	if !strings.HasPrefix(entry.DeviceID, "camera-manual-") {
		t.Errorf("id = %s, want camera-manual-<hash>", entry.DeviceID)
	}
	if strings.ContainsAny(entry.DeviceID, `/\`) {
		t.Errorf("id %s carries a path separator", entry.DeviceID)
	}
	device := entry.Device()
	if !device.PermissionRequired {
		t.Error("a hand-registered device must require permission — that is what makes it arrive pending")
	}
}

// The id is what the device is, not what it is opened with: a new password is
// not a new camera, and registering the same camera twice is caught.
func TestDeviceIDIgnoresCredentialsAndHostCase(t *testing.T) {
	adapters := DefaultAdapters()
	first, _, err := adapters.Admit(rtspRequest("rtsp://admin:old@Camera.local/stream1"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := adapters.Admit(rtspRequest("rtsp://admin:new@camera.local/stream1"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if first.DeviceID != second.DeviceID {
		t.Errorf("ids differ (%s, %s) for the same camera with a changed password", first.DeviceID, second.DeviceID)
	}
	other, _, err := adapters.Admit(rtspRequest("rtsp://camera.local/stream2"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if other.DeviceID == first.DeviceID {
		t.Error("a different stream path got the same id")
	}
}

func TestAdmitRefusesWhatNoAdapterCanOpen(t *testing.T) {
	adapters := DefaultAdapters()
	cases := map[string]Request{
		"no such adapter":                {Kind: "serial", Name: "Arduino", AdapterID: "manual.serial", Address: "serial:///dev/ttyUSB0"},
		"kind the adapter does not open": {Kind: "microphone", Name: "Mic", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/audio"},
		"capability beyond the adapter":  {Kind: "camera", Name: "Cam", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/s", Capabilities: []string{"video.frame", "audio.frame"}},
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := adapters.Admit(request, time.Now())
			if !errors.Is(err, ErrAdapterUnavailable) {
				t.Fatalf("err = %v, want ErrAdapterUnavailable", err)
			}
		})
	}
}

func TestAdmitRefusesMalformedRegistrations(t *testing.T) {
	adapters := DefaultAdapters()
	cases := map[string]Request{
		"enumerator's adapter": {Kind: "camera", Name: "Cam", AdapterID: "adapter.os-discovery", Address: "rtsp://10.0.0.2/s"},
		"no name":              {Kind: "camera", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/s"},
		"no address":           {Kind: "camera", Name: "Cam", AdapterID: "manual.rtsp"},
		"wrong scheme":         {Kind: "camera", Name: "Cam", AdapterID: "manual.rtsp", Address: "http://10.0.0.2/s"},
		"no host":              {Kind: "camera", Name: "Cam", AdapterID: "manual.http-camera", Address: "http:///snapshot"},
		"bad port":             {Kind: "camera", Name: "Cam", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2:99999/s"},
		"control character":    {Kind: "camera", Name: "Cam\x07", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/s"},
		"uppercase kind":       {Kind: "Camera", Name: "Cam", AdapterID: "manual.rtsp", Address: "rtsp://10.0.0.2/s"},
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := adapters.Admit(request, time.Now())
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
}

func TestPublicEntryHidesThePassword(t *testing.T) {
	entry, _, err := DefaultAdapters().Admit(rtspRequest("rtsp://admin:secret@10.0.0.2/s"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	public := entry.Public()
	if strings.Contains(public.Address, "secret") {
		t.Errorf("public address %q carries the password", public.Address)
	}
	if !strings.Contains(public.Address, "admin@") {
		t.Errorf("public address %q lost the user name", public.Address)
	}
	if !strings.Contains(entry.Address, "secret") {
		t.Error("the stored entry must keep the password; the adapter needs it to open the stream")
	}
}

func TestSourcePersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manual-devices.json")
	source, err := OpenSource(path)
	if err != nil {
		t.Fatal(err)
	}
	entry, _, err := DefaultAdapters().Admit(rtspRequest("rtsp://10.0.0.2/s"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := source.Add(entry); err != nil {
		t.Fatal(err)
	}
	if err := source.Add(entry); !errors.Is(err, ErrExists) {
		t.Fatalf("second add = %v, want ErrExists", err)
	}

	reopened, err := OpenSource(path)
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := reopened.Get(entry.DeviceID)
	if !ok || restored.Address != entry.Address || restored.AdapterID != entry.AdapterID {
		t.Fatalf("restored = %+v, %v; want the entry back", restored, ok)
	}

	if _, removed, err := reopened.Remove(entry.DeviceID); err != nil || !removed {
		t.Fatalf("remove = %v, %v", removed, err)
	}
	again, err := OpenSource(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Entries()) != 0 {
		t.Errorf("entries after remove and restart = %v, want none", again.Entries())
	}
}

// fakeRTSP answers one connection with the given status line and reports the
// request line it read.
func fakeRTSP(t *testing.T, statusLine string) (string, <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	requests := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		line, _ := bufio.NewReader(conn).ReadString('\n')
		requests <- line
		_, _ = conn.Write([]byte(statusLine + "\r\nCSeq: 1\r\n\r\n"))
	}()
	return listener.Addr().String(), requests
}

func TestRTSPReach(t *testing.T) {
	adapter := &RTSPAdapter{Timeout: 2 * time.Second}

	t.Run("a camera that wants credentials is there", func(t *testing.T) {
		host, requests := fakeRTSP(t, "RTSP/1.0 401 Unauthorized")
		address, _ := url.Parse("rtsp://admin:secret@" + host + "/stream1")
		if err := adapter.Reach(context.Background(), address); err != nil {
			t.Fatalf("reach = %v, want nil", err)
		}
		request := <-requests
		if !strings.HasPrefix(request, "OPTIONS rtsp://admin@") {
			t.Errorf("request line = %q, want OPTIONS without the password", request)
		}
		if strings.Contains(request, "secret") {
			t.Errorf("request line %q carries the password", request)
		}
	})

	t.Run("something that is not RTSP is not a camera", func(t *testing.T) {
		host, _ := fakeRTSP(t, "HTTP/1.1 200 OK")
		address, _ := url.Parse("rtsp://" + host + "/stream1")
		if err := adapter.Reach(context.Background(), address); !errors.Is(err, ErrUnreachable) {
			t.Fatalf("reach = %v, want ErrUnreachable", err)
		}
	})

	t.Run("nothing listening", func(t *testing.T) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		host := listener.Addr().String()
		_ = listener.Close()
		address, _ := url.Parse("rtsp://" + host + "/stream1")
		if err := adapter.Reach(context.Background(), address); !errors.Is(err, ErrUnreachable) {
			t.Fatalf("reach = %v, want ErrUnreachable", err)
		}
	})
}

func TestHTTPCameraReach(t *testing.T) {
	var status atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(int(status.Load()))
	}))
	defer server.Close()
	adapter := &HTTPCameraAdapter{Timeout: 2 * time.Second}
	address, _ := url.Parse(server.URL + "/snapshot.jpg")

	for _, answered := range []int{http.StatusOK, http.StatusUnauthorized, http.StatusForbidden} {
		status.Store(int32(answered))
		if err := adapter.Reach(context.Background(), address); err != nil {
			t.Errorf("HTTP %d: reach = %v, want nil", answered, err)
		}
	}
	for _, silent := range []int{http.StatusNotFound, http.StatusServiceUnavailable, http.StatusFound} {
		status.Store(int32(silent))
		if err := adapter.Reach(context.Background(), address); !errors.Is(err, ErrUnreachable) {
			t.Errorf("HTTP %d: reach = %v, want ErrUnreachable", silent, err)
		}
	}
}

func TestNewAdaptersEnforcesTheRegistrationRule(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("an adapter id without the manual. prefix was accepted")
		}
	}()
	NewAdapters(&badAdapter{})
}

type badAdapter struct{ RTSPAdapter }

func (*badAdapter) ID() string { return "adapter.rtsp" }
