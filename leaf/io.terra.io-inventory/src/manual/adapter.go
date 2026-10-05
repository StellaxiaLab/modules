// Package manual is the inventory's second door: devices a person registers by
// hand because no enumerator can see them — a camera on the network has no
// cable for the OS to report.
//
// It is a source, not a shortcut. What a person writes here is kept on disk and
// brought into the inventory the way an enumerator's devices are: by a scan or a
// probe that reconciles it through Registry.Sync. So a hand-registered device
// arrives at approval=pending, like everything else (IO-4), and approval is
// still a separate step a person takes.
//
// An entry is only accepted for a kind some adapter here can open. A device no
// adapter can open could be approved and enabled and would still never become
// available — accepting it would put a promise in the inventory that nothing
// keeps.
package manual

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/terra-project/terra/module/leaf/io.terra.io-inventory/inventory"
)

// AdapterPrefix marks the adapter ids a person may name. Every other adapter is
// an enumerator, and a hand-written entry must not pose as one — a scan would
// otherwise reconcile it against hardware it never was.
const AdapterPrefix = "manual."

// ErrAdapterUnavailable is a registration no adapter here can open.
var ErrAdapterUnavailable = errors.New("no adapter can open this device")

// ErrUnreachable is an adapter that tried and got no answer. It is presence,
// not a failure to look: a camera that is switched off is missing, the same
// way an unplugged mouse is.
var ErrUnreachable = errors.New("device did not answer")

// Adapter opens one kind of hand-registered device.
//
// The registration rule is the id: "manual." followed by what the adapter
// speaks, and one adapter per id. The kind is the adapter's, not the caller's —
// an RTSP adapter opens cameras, and a request that calls an RTSP address a
// microphone is asking for something this adapter cannot deliver.
type Adapter interface {
	// ID is the adapter id devices carry, "manual.<protocol>".
	ID() string
	// Kind is the only device kind this adapter opens.
	Kind() inventory.DeviceKind
	// Capabilities is what an opened device provides. A registration may name
	// a subset; naming more is naming something nothing here can provide.
	Capabilities() []string
	// CheckAddress refuses an address this adapter could never open, before
	// anything is written down.
	CheckAddress(address *url.URL) error
	// Reach asks the device whether it is there. nil means it answered; an
	// error wrapping ErrUnreachable means it did not.
	Reach(ctx context.Context, address *url.URL) error
}

// Adapters is the set a module offers, keyed by id.
type Adapters map[string]Adapter

// DefaultAdapters is what this build can open.
func DefaultAdapters() Adapters {
	return NewAdapters(
		&RTSPAdapter{Timeout: defaultReachTimeout},
		&HTTPCameraAdapter{Timeout: defaultReachTimeout},
	)
}

// NewAdapters indexes adapters by id. It panics on an id that breaks the
// registration rule, because that is a programming error in this module, not
// something a request can cause.
func NewAdapters(adapters ...Adapter) Adapters {
	result := make(Adapters, len(adapters))
	for _, adapter := range adapters {
		id := adapter.ID()
		if !strings.HasPrefix(id, AdapterPrefix) || len(id) == len(AdapterPrefix) {
			panic(fmt.Sprintf("manual adapter id %q must be %s<protocol>", id, AdapterPrefix))
		}
		if _, taken := result[id]; taken {
			panic(fmt.Sprintf("manual adapter id %q registered twice", id))
		}
		result[id] = adapter
	}
	return result
}

// For finds the adapter that opens a registration, or says why none does.
func (a Adapters) For(adapterID string, kind inventory.DeviceKind) (Adapter, error) {
	adapter, ok := a[adapterID]
	if !ok {
		return nil, fmt.Errorf("%w: %s is not an adapter on this node (known: %s)", ErrAdapterUnavailable, adapterID, strings.Join(a.IDs(), ", "))
	}
	if adapter.Kind() != kind {
		return nil, fmt.Errorf("%w: %s opens %s devices, not %s", ErrAdapterUnavailable, adapterID, adapter.Kind(), kind)
	}
	return adapter, nil
}

// IDs lists the adapter ids, sorted, for messages and status.
func (a Adapters) IDs() []string {
	ids := make([]string, 0, len(a))
	for id := range a {
		ids = append(ids, id)
	}
	sortStrings(ids)
	return ids
}

// defaultReachTimeout bounds one look at one device. A scan reaches every entry
// at once, so this is roughly how long a scan can take on a node whose cameras
// are all switched off.
const defaultReachTimeout = 3 * time.Second

// RTSPAdapter opens RTSP cameras. Reaching one is an RTSP OPTIONS request: any
// RTSP status line below 500 means a server answered — 401 included, since a
// camera that asks for credentials is a camera that is there.
//
// It does not pull frames. What it settles is presence; the stream itself is
// opened by whoever binds the device's SVI endpoint.
type RTSPAdapter struct {
	Timeout time.Duration
}

func (*RTSPAdapter) ID() string                 { return AdapterPrefix + "rtsp" }
func (*RTSPAdapter) Kind() inventory.DeviceKind { return inventory.DeviceCamera }
func (*RTSPAdapter) Capabilities() []string     { return []string{"video.frame"} }

func (*RTSPAdapter) CheckAddress(address *url.URL) error {
	if address.Scheme != "rtsp" && address.Scheme != "rtsps" {
		return fmt.Errorf("manual.rtsp opens rtsp:// or rtsps:// addresses, not %s://", address.Scheme)
	}
	if address.Hostname() == "" {
		return errors.New("manual.rtsp needs a host in the address")
	}
	return checkPort(address)
}

func (a *RTSPAdapter) Reach(ctx context.Context, address *url.URL) error {
	ctx, cancel := context.WithTimeout(ctx, timeoutOr(a.Timeout))
	defer cancel()
	port := address.Port()
	if port == "" {
		port = "554"
		if address.Scheme == "rtsps" {
			port = "322"
		}
	}
	target := net.JoinHostPort(address.Hostname(), port)
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", target)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if address.Scheme == "rtsps" {
		secure := tls.Client(conn, &tls.Config{ServerName: address.Hostname()})
		if err := secure.HandshakeContext(ctx); err != nil {
			return fmt.Errorf("%w: tls: %v", ErrUnreachable, err)
		}
		conn = secure
	}
	// The request line never carries the credentials. They are for the stream,
	// and OPTIONS is answered without them.
	request := "OPTIONS " + Redact(address) + " RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: terra-io-inventory\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return fmt.Errorf("%w: no RTSP answer: %v", ErrUnreachable, err)
	}
	status, ok := rtspStatus(line)
	if !ok {
		return fmt.Errorf("%w: not an RTSP server: %q", ErrUnreachable, strings.TrimSpace(line))
	}
	if status >= 500 {
		return fmt.Errorf("%w: RTSP %d", ErrUnreachable, status)
	}
	return nil
}

// rtspStatus reads "RTSP/1.0 200 OK".
func rtspStatus(line string) (int, bool) {
	fields := strings.Fields(line)
	if len(fields) < 2 || !strings.HasPrefix(fields[0], "RTSP/") {
		return 0, false
	}
	status, err := strconv.Atoi(fields[1])
	if err != nil || status < 100 || status > 599 {
		return 0, false
	}
	return status, true
}

// HTTPCameraAdapter opens cameras that serve frames over HTTP — snapshot or
// MJPEG URLs. Reaching one is a GET whose headers are read and whose body is
// not: an MJPEG stream never ends, and presence is settled by the status line.
// 2xx means it is there; 401 and 403 mean it is there and wants credentials.
type HTTPCameraAdapter struct {
	Timeout time.Duration
	// Client is for tests. Redirects are not followed — a camera that points
	// somewhere else is not the camera at this address.
	Client *http.Client
}

func (*HTTPCameraAdapter) ID() string                 { return AdapterPrefix + "http-camera" }
func (*HTTPCameraAdapter) Kind() inventory.DeviceKind { return inventory.DeviceCamera }
func (*HTTPCameraAdapter) Capabilities() []string     { return []string{"video.frame"} }

func (*HTTPCameraAdapter) CheckAddress(address *url.URL) error {
	if address.Scheme != "http" && address.Scheme != "https" {
		return fmt.Errorf("manual.http-camera opens http:// or https:// addresses, not %s://", address.Scheme)
	}
	if address.Hostname() == "" {
		return errors.New("manual.http-camera needs a host in the address")
	}
	return checkPort(address)
}

func (a *HTTPCameraAdapter) Reach(ctx context.Context, address *url.URL) error {
	ctx, cancel := context.WithTimeout(ctx, timeoutOr(a.Timeout))
	defer cancel()
	client := a.Client
	if client == nil {
		client = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address.String(), nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	request.Header.Set("User-Agent", "terra-io-inventory")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	_ = response.Body.Close()
	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300,
		response.StatusCode == http.StatusUnauthorized,
		response.StatusCode == http.StatusForbidden:
		return nil
	default:
		return fmt.Errorf("%w: HTTP %d", ErrUnreachable, response.StatusCode)
	}
}

func checkPort(address *url.URL) error {
	port := address.Port()
	if port == "" {
		return nil
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return fmt.Errorf("port %q is not a TCP port", port)
	}
	return nil
}

func timeoutOr(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return defaultReachTimeout
	}
	return timeout
}

// Redact spells an address without its password, for request lines, logs and
// answers. The user name stays: it says which account the device is opened
// with, and it is not the secret.
func Redact(address *url.URL) string {
	if address == nil {
		return ""
	}
	copied := *address
	if copied.User != nil {
		copied.User = url.User(copied.User.Username())
	}
	return copied.String()
}
