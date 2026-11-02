//go:build linux

package discovery

import (
	"context"
	"errors"
	"fmt"
	"syscall"
	"time"
)

const (
	watchPlatform        = "linux/netlink-uevent"
	enumerationAvailable = true

	// netlinkKObjectUevent is NETLINK_KOBJECT_UEVENT. The stdlib's syscall
	// package does not name it, and the module takes no dependency it can
	// avoid — the same reason procinput.go reads /proc rather than linking
	// libudev.
	netlinkKObjectUevent = 15
	// ueventKernelGroup is multicast group 1: what the KERNEL broadcasts.
	// Group 2 is udev's own rebroadcast, which arrives libudev-framed and
	// requires udev to be running; the kernel group needs nothing but the
	// socket, so it is the one that works on a minimal node.
	ueventKernelGroup = 1
	// receiveTimeout bounds one blocking read so the loop can notice a
	// cancelled context. Closing the socket out from under a blocked read is
	// the alternative, and it races: the fd can be reused between the close and
	// the wakeup, and then the read returns someone else's bytes.
	receiveTimeout = 500 * time.Millisecond
	// messageBuffer is generous for a uevent; the kernel's own are well under
	// 2 KiB. A message longer than this is truncated by the kernel, which for
	// this watcher is harmless — the fields it reads come first, and a
	// truncated message that still parses is still a signal to scan.
	messageBuffer = 8192
)

// netlinkSource listens to the kernel's uevent broadcast.
//
// No root and no libudev. The socket needs CAP_NET_ADMIN on some kernels and
// nothing at all on most; where it is refused, OpenWatch reports the refusal
// and polls rather than pretending the node has no hardware changes.
type netlinkSource struct{ fd int }

func newPlatformSource() (Source, string, error) {
	fd, err := syscall.Socket(
		syscall.AF_NETLINK,
		syscall.SOCK_RAW|syscall.SOCK_CLOEXEC,
		netlinkKObjectUevent,
	)
	if err != nil {
		return nil, "", fmt.Errorf("open netlink uevent socket: %w", err)
	}
	address := &syscall.SockaddrNetlink{
		Family: syscall.AF_NETLINK,
		Groups: ueventKernelGroup,
	}
	if err := syscall.Bind(fd, address); err != nil {
		_ = syscall.Close(fd)
		return nil, "", fmt.Errorf("bind netlink uevent group %d: %w", ueventKernelGroup, err)
	}
	timeout := syscall.NsecToTimeval(int64(receiveTimeout))
	if err := syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &timeout); err != nil {
		_ = syscall.Close(fd)
		return nil, "", fmt.Errorf("set netlink receive timeout: %w", err)
	}
	return &netlinkSource{fd: fd}, "listening to kernel uevents on netlink group 1", nil
}

// Next blocks until a uevent arrives that can change what an enumeration
// returns. Everything else on the socket — network interfaces, block devices,
// thermal zones — is read and dropped here rather than waking a scan.
func (s *netlinkSource) Next(ctx context.Context) error {
	buffer := make([]byte, messageBuffer)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		read, err := syscall.Read(s.fd, buffer)
		switch {
		case errors.Is(err, syscall.EAGAIN), errors.Is(err, syscall.EWOULDBLOCK), errors.Is(err, syscall.EINTR):
			// The receive timeout, or a signal. Neither is a failure: loop
			// round to re-check the context, which is the only reason the
			// timeout exists.
			continue
		case err != nil:
			return fmt.Errorf("read netlink uevent: %w", err)
		case read == 0:
			continue
		}
		event, ok := ParseUevent(buffer[:read])
		if ok && event.ChangesDevices() {
			return nil
		}
	}
}

func (s *netlinkSource) Close() error { return syscall.Close(s.fd) }
