//go:build windows

package main

// A Windows job object already kills every descendant, so there is nothing to
// sweep after a stop.
func sweepAfterStop(c *containment) {}
