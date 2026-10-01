package store

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	modulert "github.com/terra-project/terra/products/common/packages/terra-module-runtime"
)

func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "logs"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "logs", "a.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := NewManager([]modulert.SharedRoot{{Name: "share-0", Path: dir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	return manager, dir
}

// TestTraversalIsRefusedBeforeTheFilesystem: the string check in front of the
// kernel exists so a caller is told what it did wrong rather than "no such
// file". Both halves must agree that these are denied.
func TestTraversalIsRefusedBeforeTheFilesystem(t *testing.T) {
	manager, _ := newTestManager(t)
	for _, requested := range []string{
		"../etc/shadow",
		"logs/../../etc/shadow",
		"..",
		"/etc/shadow",
		"logs/../..",
	} {
		if _, err := manager.Stat("share-0", requested); !errors.Is(err, ErrPathDenied) {
			t.Errorf("Stat(%q) = %v, want ErrPathDenied", requested, err)
		}
	}
}

// TestASymlinkOutOfTheRootIsRefusedByTheKernel is the reason this package moved
// to os.Root. A shared folder is a directory the person using the machine
// writes to, so a link pointing out of it is an ordinary thing to find there —
// and the string check above cannot see it.
func TestASymlinkOutOfTheRootIsRefusedByTheKernel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privilege on Windows")
	}
	manager, dir := newTestManager(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}
	// The path is clean: no dots, no leading slash. Only the kernel can refuse it.
	if _, err := manager.Stat("share-0", "escape/secret"); err == nil {
		t.Fatal("a symlink out of the shared folder was followed")
	}
	if _, err := manager.List("share-0", "escape"); err == nil {
		t.Fatal("a symlink out of the shared folder was listed")
	}
	if _, err := manager.ReadChunk("share-0", "escape/secret", 0, 16); err == nil {
		t.Fatal("a symlink out of the shared folder was read")
	}
}

// TestAnAbsoluteSymlinkSwapIsStillRefused covers the TOCTOU shape directly: the
// entry is a plain file when it is checked and a link out of the root when it is
// opened. os.Root has no window between the two because there is only one
// syscall; the old resolve-then-open could not say the same.
func TestAnAbsoluteSymlinkSwapIsStillRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privilege on Windows")
	}
	manager, dir := newTestManager(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "swap")
	if err := os.WriteFile(target, []byte("innocent"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stat("share-0", "swap"); err != nil {
		t.Fatalf("the plain file did not read: %v", err)
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), target); err != nil {
		t.Fatal(err)
	}
	chunk, err := manager.ReadChunk("share-0", "swap", 0, 32)
	if err == nil {
		t.Fatalf("the swapped symlink was read: %q", chunk.Data)
	}
}

// TestAnUnregisteredRootIsNotAGuess: naming a folder that was never granted is
// its own answer, not an empty listing.
func TestAnUnregisteredRootIsNotAGuess(t *testing.T) {
	manager, _ := newTestManager(t)
	if _, err := manager.List("share-9", ""); !errors.Is(err, ErrRootMissing) {
		t.Errorf("List on an unregistered root = %v, want ErrRootMissing", err)
	}
}

// TestEmptyIsNotMissing is the distinction the 2026-08-25 audit found collapsed
// in three layers: a directory with nothing in it and a directory that is not
// there are different answers.
func TestEmptyIsNotMissing(t *testing.T) {
	manager, dir := newTestManager(t)
	if err := os.Mkdir(filepath.Join(dir, "empty"), 0o700); err != nil {
		t.Fatal(err)
	}
	listed, err := manager.List("share-0", "empty")
	if err != nil {
		t.Fatalf("an empty directory did not list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("empty directory listed %d entries", len(listed))
	}
	if _, err := manager.List("share-0", "absent"); !errors.Is(err, ErrNotFound) {
		t.Errorf("a missing directory = %v, want ErrNotFound", err)
	}
}

// TestListingIsRootRelativeAndSlashed keeps one node's answer readable on
// another: paths do not carry the host's separator or its absolute prefix.
func TestListingIsRootRelativeAndSlashed(t *testing.T) {
	manager, _ := newTestManager(t)
	listed, err := manager.List("share-0", "logs")
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed %+v", listed)
	}
	if listed[0].Path != "logs/a.txt" || listed[0].Name != "a.txt" {
		t.Errorf("entry = %+v", listed[0])
	}
	if listed[0].Size != 5 || listed[0].IsDir {
		t.Errorf("entry = %+v", listed[0])
	}
	top, err := manager.List("share-0", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(top) == 0 || top[0].Path != "logs" {
		t.Errorf("root listing = %+v", top)
	}
}

// TestChunksRoundTripWithTheirDigest: the digest travels with the slice so a
// receiver can reject a corrupted piece without waiting for the whole file.
func TestChunksRoundTripWithTheirDigest(t *testing.T) {
	manager, _ := newTestManager(t)
	payload := []byte(strings.Repeat("terra", 1000))
	if err := manager.WriteChunk("share-0", "deep/nested/out.bin", Chunk{Offset: 0, Data: payload}); err != nil {
		t.Fatalf("write: %v", err)
	}
	chunk, err := manager.ReadChunk("share-0", "deep/nested/out.bin", 0, len(payload))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(chunk.Data) != string(payload) {
		t.Error("the bytes did not round trip")
	}
	if chunk.SHA256 != Checksum(payload) || !chunk.EOF {
		t.Errorf("chunk = {sha:%s eof:%v}", chunk.SHA256, chunk.EOF)
	}
	whole, err := manager.ChecksumFile("share-0", "deep/nested/out.bin")
	if err != nil || whole != Checksum(payload) {
		t.Errorf("file checksum = %q, err = %v", whole, err)
	}
}

// TestReadingPastTheEndSaysDoneRatherThanFailing: a caller that asked for the
// piece after the last one is told the transfer is over.
func TestReadingPastTheEndSaysDoneRatherThanFailing(t *testing.T) {
	manager, _ := newTestManager(t)
	chunk, err := manager.ReadChunk("share-0", "logs/a.txt", 5, 16)
	if err != nil {
		t.Fatalf("reading at end of file: %v", err)
	}
	if len(chunk.Data) != 0 || !chunk.EOF {
		t.Errorf("chunk = %+v", chunk)
	}
	if _, err := manager.ReadChunk("share-0", "logs/a.txt", 6, 16); err == nil {
		t.Error("an offset past the end was accepted")
	}
}

// TestRemoveNeedsRecursiveForADirectoryAndNeverTakesTheRoot: emptying a shared
// folder is not something a path argument should manage by accident.
func TestRemoveNeedsRecursiveForADirectoryAndNeverTakesTheRoot(t *testing.T) {
	manager, dir := newTestManager(t)
	// The sentinel matters, not just the refusal: the caller's next move is
	// knowable here, and the contract promises to name it.
	if err := manager.Remove("share-0", "logs", false); !errors.Is(err, ErrRecursiveRequired) {
		t.Errorf("removing a directory without recursive = %v, want ErrRecursiveRequired", err)
	}
	if err := manager.Remove("share-0", "", true); !errors.Is(err, ErrPathDenied) {
		t.Error("the shared folder itself was removable")
	}
	if err := manager.Remove("share-0", "logs", true); err != nil {
		t.Fatalf("recursive remove: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "logs")); !os.IsNotExist(err) {
		t.Error("the directory survived a recursive remove")
	}
	if err := manager.Remove("share-0", "logs", true); !errors.Is(err, ErrNotFound) {
		t.Errorf("removing what is already gone = %v, want ErrNotFound", err)
	}
}

// TestARootThatCannotBeOpenedFailsTheWholeManager: serving three of four shared
// folders is worse than refusing to start, because the fourth looks empty
// instead of absent.
func TestARootThatCannotBeOpenedFailsTheWholeManager(t *testing.T) {
	dir := t.TempDir()
	_, err := NewManager([]modulert.SharedRoot{
		{Name: "share-0", Path: dir},
		{Name: "share-1", Path: filepath.Join(dir, "does-not-exist")},
	})
	if err == nil {
		t.Fatal("a shared folder that does not exist was skipped instead of refused")
	}
}

// TestRootsAreReportedInTheOrderGranted: the name is the contract, and the
// order is what a caller reading the first one relies on.
func TestRootsAreReportedInTheOrderGranted(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	manager, err := NewManager([]modulert.SharedRoot{{Path: first}, {Name: "media", Path: second}})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	roots := manager.Roots()
	if len(roots) != 2 || roots[0].Name != "share-0" || roots[1].Name != "media" {
		t.Errorf("roots = %+v", roots)
	}
}

// TestAnEmptyDirectoryGoesWithoutRecursive is rmdir(2), and the mount needs it:
// a person who deletes the last file in a folder and then deletes the folder is
// doing something every filesystem allows. Refusing every directory on sight
// made that impossible to say.
func TestAnEmptyDirectoryGoesWithoutRecursive(t *testing.T) {
	manager, dir := newTestManager(t)
	if _, err := manager.Mkdir("share-0", "empty", false); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := manager.Remove("share-0", "empty", false); err != nil {
		t.Fatalf("removing an empty directory without recursive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "empty")); !os.IsNotExist(err) {
		t.Error("the empty directory survived")
	}
	// And the non-empty case still names the caller's next move rather than
	// failing with whatever the kernel happened to say.
	if err := manager.Remove("share-0", "logs", false); !errors.Is(err, ErrRecursiveRequired) {
		t.Errorf("removing a directory with entries = %v, want ErrRecursiveRequired", err)
	}
}

// TestWriteTruncateMkdirRenameStayInsideTheSharedFolder: every new mutating
// entry point is a new way out, so each one is asked the same question. The
// symlink case is the one a string check cannot answer — it is a directory the
// person using the machine can create, pointing anywhere they like.
func TestWriteTruncateMkdirRenameStayInsideTheSharedFolder(t *testing.T) {
	manager, dir := newTestManager(t)
	outside := filepath.Join(filepath.Dir(dir), "outside.txt")
	if err := os.WriteFile(outside, []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(outside) })
	if err := os.Symlink(filepath.Dir(dir), filepath.Join(dir, "link")); err != nil {
		t.Skipf("this host cannot make symlinks: %v", err)
	}

	for _, testCase := range []struct {
		name string
		call func() error
	}{
		{"write climbing out", func() error {
			_, err := manager.WriteAt("share-0", "../escaped.txt", 0, []byte("x"), "", false)
			return err
		}},
		{"write through a symlink out", func() error {
			_, err := manager.WriteAt("share-0", "link/escaped.txt", 0, []byte("x"), "", false)
			return err
		}},
		{"truncate climbing out", func() error {
			_, err := manager.Truncate("share-0", "../outside.txt", 0)
			return err
		}},
		{"truncate through a symlink out", func() error {
			_, err := manager.Truncate("share-0", "link/outside.txt", 0)
			return err
		}},
		{"mkdir climbing out", func() error {
			_, err := manager.Mkdir("share-0", "../escaped", false)
			return err
		}},
		{"mkdir through a symlink out", func() error {
			_, err := manager.Mkdir("share-0", "link/escaped", true)
			return err
		}},
		{"rename out", func() error { return manager.Rename("share-0", "logs/a.txt", "../escaped.txt") }},
		{"rename in", func() error { return manager.Rename("share-0", "../outside.txt", "stolen.txt") }},
		{"rename through a symlink out", func() error {
			return manager.Rename("share-0", "logs/a.txt", "link/escaped.txt")
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if err := testCase.call(); err == nil {
				t.Fatal("the call succeeded — something left the shared folder")
			}
		})
	}

	// The proof is on the disk, not in the error values: nothing outside the
	// shared folder may have appeared, changed or moved.
	if content, err := os.ReadFile(outside); err != nil || string(content) != "not yours" {
		t.Errorf("the file outside was touched: %q, %v", content, err)
	}
	siblings, err := os.ReadDir(filepath.Dir(dir))
	if err != nil {
		t.Fatal(err)
	}
	for _, sibling := range siblings {
		switch sibling.Name() {
		case filepath.Base(dir), "outside.txt":
		default:
			t.Errorf("something appeared outside the shared folder: %s", sibling.Name())
		}
	}
}
