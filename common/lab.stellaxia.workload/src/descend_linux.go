//go:build linux

package main

import (
	"os"
	"strconv"
	"strings"
)

// procRef identifies a process well enough to not hit a recycled pid: the pid
// plus its start time from /proc/<pid>/stat.
type procRef struct {
	pid   int
	start string
}

// readStat returns ppid and starttime of pid, or ok=false if it is gone.
func readStat(pid int) (ppid int, start string, ok bool) {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return 0, "", false
	}
	s := string(b)
	i := strings.LastIndexByte(s, ')') // comm may contain spaces and parens
	if i < 0 {
		return 0, "", false
	}
	f := strings.Fields(s[i+1:]) // f[0]=state f[1]=ppid ... f[19]=starttime
	if len(f) < 20 {
		return 0, "", false
	}
	pp, err := strconv.Atoi(f[1])
	if err != nil {
		return 0, "", false
	}
	return pp, f[19], true
}

// descendants lists every live process below root by walking parent links. It
// finds processes that left root's process group (setsid, setpgid) as long as
// their parent chain is still intact, i.e. before root has died.
func descendants(root int) []procRef {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	children := map[int][]procRef{}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		if pp, start, ok := readStat(pid); ok {
			children[pp] = append(children[pp], procRef{pid, start})
		}
	}
	var out []procRef
	queue := []int{root}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		for _, c := range children[p] {
			out = append(out, c)
			queue = append(queue, c.pid)
		}
	}
	return out
}

// sameProcess reports whether ref still names the process it was taken from.
func sameProcess(ref procRef) bool {
	_, start, ok := readStat(ref.pid)
	return ok && start == ref.start
}
