//go:build !linux && !windows

package weave

import "runtime"

// Nothing is claimed for a platform nobody measured. The two paths that were
// measured are uinput and SendInput; anything else reports what it is and that
// no backend exists for it, rather than inheriting one of theirs.
func probePlatformInjection() InjectionStatus {
	return InjectionStatus{
		Platform: runtime.GOOS,
		Detail:   "no input injection backend is defined for " + runtime.GOOS,
	}
}

// injectionImplemented is false: no backend is claimed for a platform nobody
// measured, and inheriting one of the other two would claim exactly that.
const injectionImplemented = false

func newInjector() (injector, error) { return nil, ErrInjectionUnimplemented }
