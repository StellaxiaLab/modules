//go:build linux

package weave

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withSessionDir(t *testing.T, files map[string]string) {
	t.Helper()
	directory := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	previous := logindSessionDir
	logindSessionDir = directory
	t.Cleanup(func() { logindSessionDir = previous })
}

// D-15. A session that says it is locked stops injection, because uinput
// reaches a lock screen exactly as a physical mouse does.
func TestALockedLogindSessionBlocksInjection(t *testing.T) {
	withSessionDir(t, map[string]string{
		"c1": "TYPE=wayland\nLOCKED_HINT=yes\nACTIVE=1\n",
		"c2": "TYPE=tty\nLOCKED_HINT=no\n",
	})
	state := platformLockState()
	if !state.Locked {
		t.Fatalf("lock state = %+v, want locked", state)
	}
	if !strings.Contains(state.Reason, "c1") {
		t.Fatalf("reason = %q, want it to name the session it read", state.Reason)
	}
}

// "Nobody said locked" and "there was nobody to ask" are different facts, and
// the fleet's nodes are all the second one — every node runs at a tty with no
// graphical session and therefore no lock screen to bypass. Both answers
// permit injection; the reason is what keeps them apart, so a node that looks
// permissive can be checked instead of assumed safe.
func TestTheTwoWaysOfNotBeingLockedAreDistinguishable(t *testing.T) {
	withSessionDir(t, map[string]string{"c1": "TYPE=tty\nLOCKED_HINT=no\n"})
	answered := platformLockState()
	if answered.Locked {
		t.Fatalf("lock state = %+v, want unlocked", answered)
	}

	logindSessionDir = filepath.Join(t.TempDir(), "absent")
	absent := platformLockState()
	if absent.Locked {
		t.Fatalf("lock state with no session records = %+v, want unlocked", absent)
	}
	if absent.Reason == answered.Reason {
		t.Fatalf("both answers give the reason %q; a node with no session and a node that reported unlocked must not read alike", absent.Reason)
	}
}

// logind writes .ref files alongside the session records. They carry no hint,
// and reading them as sessions would make the count in the reason a number of
// files rather than a number of sessions.
func TestReferenceFilesAreNotCountedAsSessions(t *testing.T) {
	withSessionDir(t, map[string]string{
		"c1":     "TYPE=tty\nLOCKED_HINT=no\n",
		"c1.ref": "",
	})
	state := platformLockState()
	if state.Locked || !strings.Contains(state.Reason, "read 1") {
		t.Fatalf("lock state = %+v, want unlocked having read exactly one session", state)
	}
}
