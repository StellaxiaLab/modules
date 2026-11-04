package main

// A minimal RTSP client: just enough to probe a camera and to receive its
// first media track as RTP over the RTSP connection itself (RFC 2326 §10.12,
// "interleaved"). No decoding — the frames a binding carries are the RTP
// packets as the camera sent them, which a file sink records and a viewer can
// replay. Basic authentication only; Digest is a follow-up.

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const rtspDialTimeout = 5 * time.Second

// Reason codes the module reports (status_reason, contract §12.12).
const (
	reasonUnreachable  = "rtsp_unreachable"
	reasonUnauthorized = "rtsp_unauthorized"
	reasonRefused      = "rtsp_refused"
	reasonNoMedia      = "rtsp_no_media"
	reasonBadAnswer    = "rtsp_bad_answer"
)

type rtspError struct{ reason, detail string }

func (e rtspError) Error() string { return e.reason + ": " + e.detail }

type rtspConn struct {
	target   *url.URL
	user     string
	password string
	conn     net.Conn
	reader   *bufio.Reader
	cseq     int
	session  string
}

func dialRTSP(ctx context.Context, address, user, password string) (*rtspConn, error) {
	target, err := url.Parse(address)
	if err != nil || target.Scheme != "rtsp" || target.Host == "" {
		return nil, rtspError{reasonBadAnswer, "not an rtsp:// address"}
	}
	if target.User != nil {
		// Credentials belong in their own (secret) fields, not in the address.
		user = target.User.Username()
		password, _ = target.User.Password()
		target.User = nil
	}
	host := target.Host
	if target.Port() == "" {
		host = net.JoinHostPort(target.Hostname(), "554")
	}
	dialer := net.Dialer{Timeout: rtspDialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, rtspError{reasonUnreachable, err.Error()}
	}
	return &rtspConn{target: target, user: user, password: password, conn: conn, reader: bufio.NewReader(conn)}, nil
}

func (c *rtspConn) close() error { return c.conn.Close() }

// request sends one RTSP request and reads its answer. Interleaved data that
// arrives before the answer (a camera may start sending after PLAY) is not
// expected here: request is only used before PLAY.
func (c *rtspConn) request(method, uri string, headers map[string]string) (int, map[string]string, string, error) {
	c.cseq++
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s RTSP/1.0\r\nCSeq: %d\r\nUser-Agent: terra-sample-camera\r\n", method, uri, c.cseq)
	if c.user != "" {
		fmt.Fprintf(&b, "Authorization: Basic %s\r\n", base64.StdEncoding.EncodeToString([]byte(c.user+":"+c.password)))
	}
	if c.session != "" {
		fmt.Fprintf(&b, "Session: %s\r\n", c.session)
	}
	for key, value := range headers {
		fmt.Fprintf(&b, "%s: %s\r\n", key, value)
	}
	b.WriteString("\r\n")
	_ = c.conn.SetDeadline(time.Now().Add(rtspDialTimeout))
	defer func() { _ = c.conn.SetDeadline(time.Time{}) }()
	if _, err := io.WriteString(c.conn, b.String()); err != nil {
		return 0, nil, "", rtspError{reasonUnreachable, err.Error()}
	}
	status, err := c.reader.ReadString('\n')
	if err != nil {
		return 0, nil, "", rtspError{reasonBadAnswer, err.Error()}
	}
	fields := strings.Fields(status)
	if len(fields) < 2 || !strings.HasPrefix(fields[0], "RTSP/") {
		return 0, nil, "", rtspError{reasonBadAnswer, strings.TrimSpace(status)}
	}
	code, err := strconv.Atoi(fields[1])
	if err != nil {
		return 0, nil, "", rtspError{reasonBadAnswer, strings.TrimSpace(status)}
	}
	answer := map[string]string{}
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return 0, nil, "", rtspError{reasonBadAnswer, err.Error()}
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if key, value, ok := strings.Cut(line, ":"); ok {
			answer[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}
	body := ""
	if length, _ := strconv.Atoi(answer["content-length"]); length > 0 {
		raw := make([]byte, length)
		if _, err := io.ReadFull(c.reader, raw); err != nil {
			return 0, nil, "", rtspError{reasonBadAnswer, err.Error()}
		}
		body = string(raw)
	}
	switch {
	case code == 401:
		return code, answer, body, rtspError{reasonUnauthorized, method + " answered 401"}
	case code >= 300:
		return code, answer, body, rtspError{reasonRefused, method + " answered " + strconv.Itoa(code)}
	}
	return code, answer, body, nil
}

// probe is OPTIONS then DESCRIBE: the camera is reachable, lets us in, and
// describes at least one media track.
func probe(ctx context.Context, address, user, password string) error {
	c, err := dialRTSP(ctx, address, user, password)
	if err != nil {
		return err
	}
	defer c.close()
	if _, _, _, err := c.request("OPTIONS", c.target.String(), nil); err != nil {
		return err
	}
	_, err = c.describe()
	return err
}

// describe answers the control URL of the first media track.
func (c *rtspConn) describe() (string, error) {
	_, headers, sdp, err := c.request("DESCRIBE", c.target.String(), map[string]string{"Accept": "application/sdp"})
	if err != nil {
		return "", err
	}
	base := c.target.String()
	if contentBase := headers["content-base"]; contentBase != "" {
		base = contentBase
	}
	inMedia := false
	for _, line := range strings.Split(sdp, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "m=") {
			if inMedia {
				break
			}
			inMedia = true
			continue
		}
		if inMedia && strings.HasPrefix(line, "a=control:") {
			control := strings.TrimPrefix(line, "a=control:")
			if strings.HasPrefix(control, "rtsp://") {
				return control, nil
			}
			if control == "*" {
				return base, nil
			}
			return strings.TrimSuffix(base, "/") + "/" + control, nil
		}
	}
	if inMedia {
		return base, nil // a single track with no control line is the base itself
	}
	return "", rtspError{reasonNoMedia, "the description names no media track"}
}

// rtspStream receives the first track's RTP packets over the RTSP connection.
type rtspStream struct {
	c      *rtspConn
	once   sync.Once
	closed chan struct{}
}

func openStream(ctx context.Context, address, user, password string) (*rtspStream, error) {
	c, err := dialRTSP(ctx, address, user, password)
	if err != nil {
		return nil, err
	}
	track, err := c.describe()
	if err != nil {
		_ = c.close()
		return nil, err
	}
	_, headers, _, err := c.request("SETUP", track, map[string]string{"Transport": "RTP/AVP/TCP;unicast;interleaved=0-1"})
	if err != nil {
		_ = c.close()
		return nil, err
	}
	session, _, _ := strings.Cut(headers["session"], ";")
	c.session = strings.TrimSpace(session)
	if _, _, _, err := c.request("PLAY", c.target.String(), map[string]string{"Range": "npt=0.000-"}); err != nil {
		_ = c.close()
		return nil, err
	}
	return &rtspStream{c: c, closed: make(chan struct{})}, nil
}

// Next answers the next RTP packet of channel 0. RTCP (channel 1) and RTSP
// messages the camera sends in between are skipped. The camera closing the
// connection is the end of the stream.
func (s *rtspStream) Next(ctx context.Context) ([]byte, error) {
	for {
		select {
		case <-s.closed:
			return nil, errors.New("closed")
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		marker, err := s.c.reader.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil, io.EOF
			}
			return nil, s.readErr(err)
		}
		if marker != '$' {
			// An RTSP message (a keep-alive answer, an announcement): skip it.
			if err := s.skipMessage(marker); err != nil {
				return nil, s.readErr(err)
			}
			continue
		}
		var header [3]byte
		if _, err := io.ReadFull(s.c.reader, header[:]); err != nil {
			return nil, s.readErr(err)
		}
		length := int(header[1])<<8 | int(header[2])
		payload := make([]byte, length)
		if _, err := io.ReadFull(s.c.reader, payload); err != nil {
			return nil, s.readErr(err)
		}
		if header[0] == 0 {
			return payload, nil
		}
	}
}

func (s *rtspStream) readErr(err error) error {
	select {
	case <-s.closed:
		return errors.New("closed")
	default:
	}
	return rtspError{reasonUnreachable, err.Error()}
}

// skipMessage reads past one RTSP message whose first byte was already read.
func (s *rtspStream) skipMessage(first byte) error {
	line, err := s.c.reader.ReadString('\n')
	if err != nil {
		return err
	}
	_ = append([]byte{first}, line...)
	length := 0
	for {
		header, err := s.c.reader.ReadString('\n')
		if err != nil {
			return err
		}
		header = strings.TrimRight(header, "\r\n")
		if header == "" {
			break
		}
		if key, value, ok := strings.Cut(header, ":"); ok && strings.EqualFold(strings.TrimSpace(key), "content-length") {
			length, _ = strconv.Atoi(strings.TrimSpace(value))
		}
	}
	if length > 0 {
		_, err = s.c.reader.Discard(length)
	}
	return err
}

// Close tears the session down and unblocks a Next in flight.
func (s *rtspStream) Close(string) error {
	s.once.Do(func() {
		close(s.closed)
		_ = s.c.conn.SetDeadline(time.Now().Add(time.Second))
		_, _ = io.WriteString(s.c.conn, fmt.Sprintf("TEARDOWN %s RTSP/1.0\r\nCSeq: %d\r\nSession: %s\r\n\r\n", s.c.target, s.c.cseq+1, s.c.session))
		_ = s.c.close()
	})
	return nil
}
