//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// Each launched program is put in its own Job Object that kills its members when
// the handle closes. That is FR-H5: if the daemon takes this module down, the
// handle closes with the module process and the programs go with it.

var (
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW   = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJob  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJob = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject = kernel32.NewProc("TerminateJobObject")
)

const (
	jobObjectExtendedLimitInformation = 9
	jobLimitKillOnJobClose            = 0x2000
	processSetQuota                   = 0x0100
)

type ioCounters struct{ a, b, c, d, e, f uint64 }

type jobBasicLimit struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobExtendedLimit struct {
	Basic                 jobBasicLimit
	IO                    ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func prepareCmd(cmd *exec.Cmd) {}

type containment struct{ job syscall.Handle }

func contain(cmd *exec.Cmd) (*containment, error) {
	h, _, err := procCreateJobObjectW.Call(0, 0)
	if h == 0 {
		return nil, err
	}
	info := jobExtendedLimit{}
	info.Basic.LimitFlags = jobLimitKillOnJobClose
	r, _, err := procSetInformationJob.Call(h, jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r == 0 {
		syscall.CloseHandle(syscall.Handle(h))
		return nil, err
	}
	ph, err := syscall.OpenProcess(processSetQuota|syscall.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		syscall.CloseHandle(syscall.Handle(h))
		return nil, err
	}
	defer syscall.CloseHandle(ph)
	if r, _, err := procAssignProcessToJob.Call(h, uintptr(ph)); r == 0 {
		syscall.CloseHandle(syscall.Handle(h))
		return nil, err
	}
	return &containment{job: syscall.Handle(h)}, nil
}

// interrupt asks the program to stop politely. Windows has no signal that
// reaches an arbitrary console-less program, so there is nothing to send: the
// caller then terminates, and the stop response says forced=true.
func (c *containment) interrupt(cmd *exec.Cmd) bool { return false }

func (c *containment) terminate(cmd *exec.Cmd) {
	if c != nil {
		procTerminateJobObject.Call(uintptr(c.job), 1)
	}
	_ = cmd.Process.Kill()
}

func (c *containment) close() {
	if c != nil {
		syscall.CloseHandle(c.job)
	}
}
