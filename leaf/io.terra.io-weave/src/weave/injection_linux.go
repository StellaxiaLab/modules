//go:build linux

package weave

import (
	"errors"
	"io/fs"
	"os"
)

// uinputDevice is the kernel's user-space input device factory. It is built
// into the kernel rather than shipped as a module, so nothing here needs an
// out-of-tree driver or a signature — measurement confirmed a virtual mouse
// created and enumerated on a headless node with no display server.
const uinputDevice = "/dev/uinput"

// uinputAccessScript is the elevated step that grants access to it (D-25). It
// is named in the failure message because the message is the only place
// anybody reads: a module that reports "permission denied" and leaves the
// operator to find the rule is the shape of install this decision exists to
// stop. The path is relative to the installed module directory, and the file
// really ships there — build-release copies everything in a module package
// except its Go source.
const uinputAccessScript = "install/linux/install-uinput-access.sh"

// injectionImplemented says this build carries a backend. It is a constant per
// platform rather than a runtime answer because the question it answers is
// "what was compiled in", and a node that reports it from anything else would
// be reporting the platform check twice under two names.
const injectionImplemented = true

// newInjector creates this node's virtual pointer.
func newInjector() (injector, error) { return newUinputPointer() }

func probePlatformInjection() InjectionStatus {
	status := InjectionStatus{Platform: "linux/uinput"}
	handle, err := os.OpenFile(uinputDevice, os.O_WRONLY, 0)
	if err == nil {
		_ = handle.Close()
		status.Available = true
		status.Detail = uinputDevice + " is openable"
		return status
	}
	switch {
	case errors.Is(err, fs.ErrNotExist):
		status.Detail = uinputDevice + " does not exist; the uinput kernel node is missing (modprobe uinput)"
	case errors.Is(err, fs.ErrPermission):
		// The install is supposed to have written the udev rule and put the
		// daemon user in the group. Naming both halves matters: the rule alone
		// is not enough, and neither is the group until the session restarts.
		status.Detail = uinputDevice + " is not writable by this user; run the module's " +
			uinputAccessScript + " as root (it installs /etc/udev/rules.d/70-terra-uinput.rules and the terra-input group)" +
			" and restart the daemon so the group membership takes effect"
	default:
		status.Detail = "cannot open " + uinputDevice + ": " + err.Error()
	}
	return status
}
