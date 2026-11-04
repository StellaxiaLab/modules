//go:build linux

package weave

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// logindSessionDir is where systemd-logind records one file per session.
//
// This is read rather than asked over D-Bus on purpose. The files are plain
// key=value, world-readable, and present on every systemd node; a D-Bus client
// would be a dependency, a socket that may not exist in the module's sandbox,
// and a blocking call on the injection path. What is lost is the properties
// logind only exposes over the bus, and LOCKED_HINT is not one of them.
var logindSessionDir = "/run/systemd/sessions"

// platformLockState looks for a session that says it is locked.
//
// LOCKED_HINT is a hint in the literal sense: a screen locker sets it through
// logind, and a locker that does not set it leaves the file saying no. So a
// "yes" is trustworthy and a "no" is only the absence of a claim — which is
// why the reason says which sessions were read rather than just answering.
func platformLockState() lockState {
	entries, err := os.ReadDir(logindSessionDir)
	if err != nil {
		// No logind, no session files, or no permission. On a node running at
		// a tty this is the ordinary case, not a fault.
		return lockState{Reason: "no logind session records under " + logindSessionDir + " (" + err.Error() + ")"}
	}
	read := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		// logind also writes .ref files here; only the session records carry
		// the hint, and a name is a cheaper filter than parsing every file.
		if strings.HasSuffix(entry.Name(), ".ref") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(logindSessionDir, entry.Name()))
		if err != nil {
			continue
		}
		read++
		if sessionIsLocked(string(content)) {
			return lockState{
				Locked: true,
				Reason: "logind session " + entry.Name() + " reports LOCKED_HINT=yes",
			}
		}
	}
	if read == 0 {
		return lockState{Reason: "no readable logind session records under " + logindSessionDir}
	}
	return lockState{Reason: "no logind session reports LOCKED_HINT=yes (read " + strconv.Itoa(read) + ")"}
}

func sessionIsLocked(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		if strings.EqualFold(key, "LOCKED_HINT") && strings.EqualFold(strings.TrimSpace(value), "yes") {
			return true
		}
	}
	return false
}
