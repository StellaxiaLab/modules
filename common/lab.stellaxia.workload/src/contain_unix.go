//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// Each program leads its own process group so a stop reaches its children, and
// on Linux it is killed if this module dies (FR-H5).
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	setParentDeathSignal(cmd.SysProcAttr)
}

type containment struct{}

func contain(cmd *exec.Cmd) (*containment, error) { return &containment{}, nil }

func (c *containment) interrupt(cmd *exec.Cmd) bool {
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) == nil
}

func (c *containment) terminate(cmd *exec.Cmd) {
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = cmd.Process.Kill()
}

func (c *containment) close() {}
