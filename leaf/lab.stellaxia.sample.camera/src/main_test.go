package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/StellaxiaLab/terra-sdk/conformance"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

// fakeCamera is an RTSP server just big enough for the client: OPTIONS,
// DESCRIBE (one video track), SETUP over TCP interleaved, PLAY — then RTP on
// channel 0 with an RTCP packet on channel 1 between. packets bounds the
// stream (0 = until the client goes away).
type fakeCamera struct {
	listener net.Listener
	user     string
	password string
	packets  int
	mu       sync.Mutex
	plays    int
}

func startCamera(t *testing.T, user, password string, packets int) *fakeCamera {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	camera := &fakeCamera{listener: listener, user: user, password: password, packets: packets}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go camera.serve(conn)
		}
	}()
	return camera
}

func (c *fakeCamera) url() string { return "rtsp://" + c.listener.Addr().String() + "/stream1" }

func (c *fakeCamera) serve(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	for {
		request, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		method := strings.Fields(request)[0]
		headers := map[string]string{}
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				break
			}
			key, value, _ := strings.Cut(line, ":")
			headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
		cseq := headers["cseq"]
		if c.user != "" && headers["authorization"] != "Basic "+base64.StdEncoding.EncodeToString([]byte(c.user+":"+c.password)) {
			fmt.Fprintf(conn, "RTSP/1.0 401 Unauthorized\r\nCSeq: %s\r\nWWW-Authenticate: Basic realm=\"cam\"\r\n\r\n", cseq)
			continue
		}
		switch method {
		case "OPTIONS":
			fmt.Fprintf(conn, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nPublic: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n\r\n", cseq)
		case "DESCRIBE":
			sdp := "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=cam\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=1\r\n"
			fmt.Fprintf(conn, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nContent-Base: %s/\r\nContent-Type: application/sdp\r\nContent-Length: %d\r\n\r\n%s", cseq, c.url(), len(sdp), sdp)
		case "SETUP":
			fmt.Fprintf(conn, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: 12345678;timeout=60\r\n\r\n", cseq)
		case "PLAY":
			if headers["session"] != "12345678" {
				fmt.Fprintf(conn, "RTSP/1.0 454 Session Not Found\r\nCSeq: %s\r\n\r\n", cseq)
				continue
			}
			c.mu.Lock()
			c.plays++
			c.mu.Unlock()
			fmt.Fprintf(conn, "RTSP/1.0 200 OK\r\nCSeq: %s\r\nSession: 12345678\r\n\r\n", cseq)
			for n := 1; c.packets == 0 || n <= c.packets; n++ {
				rtp := []byte(fmt.Sprintf("rtp-%d", n))
				if _, err := conn.Write(append([]byte{'$', 0, 0, byte(len(rtp))}, rtp...)); err != nil {
					return
				}
				if n == 1 {
					rtcp := []byte("rtcp")
					_, _ = conn.Write(append([]byte{'$', 1, 0, byte(len(rtcp))}, rtcp...))
				}
				time.Sleep(time.Millisecond)
			}
			return // the camera ends the stream
		case "TEARDOWN":
			return
		}
	}
}

func TestProbeSaysWhyACameraCannotBeUsed(t *testing.T) {
	ctx := context.Background()
	open := startCamera(t, "", "", 1)
	if err := probe(ctx, open.url(), "", ""); err != nil {
		t.Fatalf("probe of an open camera: %v", err)
	}
	locked := startCamera(t, "viewer", "s3cret", 1)
	if err := probe(ctx, locked.url(), "viewer", "s3cret"); err != nil {
		t.Fatalf("probe with the right password: %v", err)
	}
	var rtsp rtspError
	if err := probe(ctx, locked.url(), "viewer", "wrong"); !errors.As(err, &rtsp) || rtsp.reason != reasonUnauthorized {
		t.Fatalf("wrong password = %v, want %s", err, reasonUnauthorized)
	}
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	address := closed.Addr().String()
	_ = closed.Close()
	if err := probe(ctx, "rtsp://"+address+"/s", "", ""); !errors.As(err, &rtsp) || rtsp.reason != reasonUnreachable {
		t.Fatalf("nothing listening = %v, want %s", err, reasonUnreachable)
	}
}

func TestStreamCarriesTheVideoTrackAndEnds(t *testing.T) {
	camera := startCamera(t, "", "", 3)
	stream, err := openStream(context.Background(), camera.url(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close("done")
	var got []string
	for {
		packet, err := stream.Next(context.Background())
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, string(packet))
	}
	// Channel 0 only: the RTCP packet on channel 1 is not a frame.
	if strings.Join(got, ",") != "rtp-1,rtp-2,rtp-3" {
		t.Fatalf("packets = %v", got)
	}
}

// The module as the node sees it passes the resourcizer conformance kit,
// source rules included, against a camera.
func TestModulePassesTheResourcizerConformance(t *testing.T) {
	camera := startCamera(t, "viewer", "s3cret-pass", 0)
	framework, err := newFramework()
	if err != nil {
		t.Fatal(err)
	}
	id, err := conformance.NewIdentity(moduleID, 1)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modulesdk.Config{Identity: modulert.WorkloadIdentity{
		ModuleID: id.ModuleID, InstanceID: id.InstanceID, Epoch: id.Epoch, Nonce: id.Nonce, Credential: id.Credential, Endpoint: id.Endpoint,
	}, Operations: operationsHandler(framework)}
	if err := framework.Install(&cfg); err != nil {
		t.Fatal(err)
	}
	server, err := modulesdk.Listen(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() { _ = server.Serve(ctx) }()

	sample, _ := json.Marshal(map[string]string{"url": camera.url(), "user": "viewer", "password": "s3cret-pass"})
	report := conformance.Check(context.Background(), id, conformance.CheckOptions{
		OperationPath: "/api/modules/" + moduleID + "/v1/status",
		SVI:           true,
		Resourcizer: &conformance.ResourcizerPlan{
			Samples: []conformance.InstanceSample{{Name: "front-door", Type: "camera.rtsp", Config: sample}},
			Invalid: []conformance.InstanceSample{
				{Name: "http", Type: "camera.rtsp", Config: json.RawMessage(`{"url":"http://10.0.0.5/s"}`)},
				{Name: "inline", Type: "camera.rtsp", Config: json.RawMessage(`{"url":"rtsp://u:p@10.0.0.5/s"}`)},
			},
		},
	})
	if !report.OK() {
		t.Fatalf("conformance:\n%s", report.String())
	}
	for _, result := range report.Results {
		if result.Level() == conformance.StatusSkip && strings.HasPrefix(result.Name, "source") {
			t.Fatalf("the source rules were skipped:\n%s", report.String())
		}
	}
}

// A camera that refuses the password is a failed instance with the reason —
// an unavailable resource the controller can explain.
func TestRefusedCameraIsAFailedInstanceWithTheReason(t *testing.T) {
	camera := startCamera(t, "viewer", "right", 0)
	framework, err := newFramework()
	if err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(map[string]string{"url": camera.url(), "user": "viewer", "password": "wrong"})
	framework.ApplyInstances(context.Background(), modulert.InstanceSet{Instances: []modulert.InstanceSpec{{Name: "cam", Type: "camera.rtsp", Config: config}}})
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		statuses := framework.Instances()
		if len(statuses) == 1 && statuses[0].State == modulert.InstanceFailed {
			if statuses[0].Reason != reasonUnauthorized {
				t.Fatalf("reason = %q", statuses[0].Reason)
			}
			resources, _ := framework.Resources(context.Background())
			if len(resources) != 1 || resources[0].StatusReason != reasonUnauthorized {
				t.Fatalf("descriptor = %+v", resources)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the instance never failed: %+v", framework.Instances())
}
