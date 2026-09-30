package weave

import (
	"errors"

	protocol "github.com/terra-project/terra/products/common/packages/terra-protocol"
)

// Whether this node COULD drive its own pointer, and why not when it cannot.
//
// A module that is "installed" while the thing it installs for quietly does not
// work is the trap this repository has walked into before, so the state is
// published whether or not anything is injecting: Available says the platform
// would let us open the device, Implemented says whether there is anything to
// open it with, and the two are separate because they fail for different
// reasons and are fixed by different people. A missing udev rule is the
// operator's; a missing backend is ours.
//
// On Linux the precondition is /dev/uinput being openable, which the module's
// install is supposed to arrange with a udev rule and a group. Group
// membership does not take effect until the next login, so the check is an
// actual open rather than a look at the group list — "I added you to the
// group, why does it still not work" is exactly what a group-list check would
// have answered wrongly.
//
// On Windows the precondition is not running in session 0: injection targets
// the interactive desktop, and a service in session 0 has none. Measurement
// says modules run in the user's session, so this is a guard against a future
// packaging change rather than a known failure.

// InjectionStatus is what a caller needs to know before expecting the pointer
// on this node to move.
type InjectionStatus struct {
	// Implemented is whether this build has an OS injection backend at all.
	Implemented bool `json:"implemented"`
	// Available is whether the platform would permit one to run here.
	Available bool `json:"available"`
	// Detail says why, in words meant for whoever has to fix it.
	Detail string `json:"detail"`
	// Platform names what was checked, so a report from a node says which
	// question was asked of it.
	Platform string `json:"platform"`
}

// Ready reports whether an injector could actually be opened right now. Both
// halves have to hold, and they are kept apart everywhere else precisely so
// that this is the only place they are conflated.
func (s InjectionStatus) Ready() bool { return s.Implemented && s.Available }

// ProbeInjection measures the platform precondition and reports whether this
// build carries a backend for it.
func ProbeInjection() InjectionStatus {
	status := probePlatformInjection()
	status.Implemented = injectionImplemented
	if status.Available && !status.Implemented {
		status.Detail = "platform permits input injection; no injection backend in this build (" + status.Detail + ")"
	}
	return status
}

// injector is the OS-facing half of the projection: one virtual pointing
// device, for as long as a binding holds it.
//
// Kept this narrow on purpose. Everything above it — the wire, the binding,
// the permission tier, the arbitration state — is identical whether the frame
// ends in a kernel device or in a terminal escape sequence, so the difference
// between a node that injects and a node that translates is this interface and
// nothing else.
type injector interface {
	// Pointer places the pointer and reconciles its buttons and wheel.
	Pointer(event protocol.PointerEvent) error
	// Release drops every button the device is holding, leaving it created.
	Release() error
	// Close destroys the device. It must be safe to call while a Pointer call
	// is in flight — the watchdog does exactly that (D-22 layer 4) — and safe
	// to call twice, because an orderly teardown races the watchdog.
	Close() error
	// Describe names what was created, for the state a person reads.
	Describe() string
	// SysfsPath is where the OS put the device, or empty where the question
	// does not apply. Reported so that "the device is filtered as one of ours"
	// can be checked against the kernel rather than believed.
	SysfsPath() string
}

// errInjectionClosed is what an injector returns once its device is gone. It is
// not a fault: the watchdog closing a device out from under an in-flight write
// is the mechanism working.
var errInjectionClosed = errors.New("io-weave: the virtual input device is closed")

// ErrInjectionUnimplemented is returned by newInjector on a build with no
// backend. Distinct from a platform refusal so the two never share a message:
// one is fixed by installing something on the node, the other by shipping a
// different build.
var ErrInjectionUnimplemented = errors.New("io-weave: this build has no input injection backend")
