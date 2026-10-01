//go:build windows

package weave

import (
	"strconv"
	"syscall"
	"unsafe"
)

// Session 0 is the non-interactive session Windows reserves for services. It
// has no desktop, so SendInput there reaches nothing: the call succeeds and
// the pointer does not move, which is the worst shape a failure can take.
//
// Measurement on a real desktop found the module host running in session 1 —
// the installer registers the daemon to start at logon — so this is a guard
// against a packaging change that would move it, not a known failure. It is
// checked anyway because the symptom of getting it wrong is silence.
func probePlatformInjection() InjectionStatus {
	status := InjectionStatus{Platform: "windows/sendinput"}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	processIDToSessionID := kernel32.NewProc("ProcessIdToSessionId")
	if err := processIDToSessionID.Find(); err != nil {
		status.Detail = "cannot resolve ProcessIdToSessionId: " + err.Error()
		return status
	}
	var session uint32
	result, _, err := processIDToSessionID.Call(uintptr(syscall.Getpid()), uintptr(unsafe.Pointer(&session)))
	if result == 0 {
		status.Detail = "ProcessIdToSessionId failed: " + err.Error()
		return status
	}
	if session == 0 {
		status.Detail = "this module runs in session 0, which has no interactive desktop; injected input would go nowhere"
		return status
	}
	status.Available = true
	status.Detail = "running in interactive session " + strconv.FormatUint(uint64(session), 10)
	return status
}

// injectionImplemented is false until the SendInput backend lands. The
// platform probe above still runs and still answers: a node whose packaging
// moved it into session 0 has to hear that from the probe, not discover it
// when a backend arrives and silently does nothing.
const injectionImplemented = false

// newInjector has nothing to create yet. It refuses with the build-shaped
// error rather than the platform-shaped one, because installing something on
// this node would not help.
func newInjector() (injector, error) { return nil, ErrInjectionUnimplemented }
