//go:build !windows

package main

import (
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// Each program leads its own process group so a stop reaches its children, and
// on Linux it is killed if this module dies (FR-H5).
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	setParentDeathSignal(cmd.SysProcAttr)
	// A descendant that escaped the group can keep the output pipe open; do not
	// let Wait block on it forever.
	cmd.WaitDelay = time.Second
}

// containment remembers the descendants seen when a stop began. A child that
// left the process group (setsid) is not reached by kill(-pgid), and once its
// parent dies it can no longer be found by walking parent links.
type containment struct {
	mu   sync.Mutex
	seen []procRef
}

func contain(cmd *exec.Cmd) (*containment, error) { return &containment{}, nil }

func (c *containment) snapshot(cmd *exec.Cmd) {
	d := descendants(cmd.Process.Pid)
	c.mu.Lock()
	c.seen = append(c.seen, d...)
	c.mu.Unlock()
}

func (c *containment) interrupt(cmd *exec.Cmd) bool {
	c.snapshot(cmd)
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) == nil
}

func (c *containment) terminate(cmd *exec.Cmd) {
	c.snapshot(cmd)
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = cmd.Process.Kill()
	c.sweep()
}

// sweep kills the remembered descendants that are still alive.
func (c *containment) sweep() {
	c.mu.Lock()
	seen := c.seen
	c.seen = nil
	c.mu.Unlock()
	for _, ref := range seen {
		if sameProcess(ref) {
			_ = syscall.Kill(ref.pid, syscall.SIGKILL)
		}
	}
}

func (c *containment) close() {}

// sweepAfterStop kills leftovers once the program itself has exited.
func sweepAfterStop(c *containment) { c.sweep() }
