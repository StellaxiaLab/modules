//go:build !linux && !windows

package main

import "syscall"

func setParentDeathSignal(a *syscall.SysProcAttr) {}
