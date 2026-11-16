//go:build linux

package main

import "syscall"

func setParentDeathSignal(a *syscall.SysProcAttr) { a.Pdeathsig = syscall.SIGKILL }
