//go:build !linux

package weave

import "runtime"

// platformLockState answers honestly for a platform with no backend.
//
// Nothing is claimed: on Windows the Secure Desktop already refuses injection
// by itself (D-15), and there is no injection backend here to gate anyway, so
// a check invented for this file would be an answer nobody measured.
func platformLockState() lockState {
	return lockState{Reason: "lock state is not determined on " + runtime.GOOS}
}
