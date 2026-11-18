//go:build !linux && !windows

package main

// Without /proc there is no cheap descendant walk; containment relies on the
// process group alone on these platforms.
type procRef struct {
	pid   int
	start string
}

func descendants(root int) []procRef { return nil }
func sameProcess(ref procRef) bool   { return false }
