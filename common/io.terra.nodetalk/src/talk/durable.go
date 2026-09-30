package talk

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// Durability of the store's files.
//
// os.Rename gives atomic REPLACEMENT, not durability. The rename can reach the
// disk while the data blocks behind it have not, and after an unclean shutdown
// the file comes back correctly named and full of NUL bytes — a JSON decoder
// meets '\x00' where it expected '{'. That is not hypothetical: it is how a
// desktop's cursor.json was found on 2026-09-07, and it took the whole module
// down with it because Behind reads that file for every conversations.list row.
//
// Every replacement in this package therefore goes through replaceFileDurable
// and every append through appendLine's Sync. The cost is one flush per write;
// these are control files and per-message log lines, not a throughput path.

// replaceFileDurable writes payload into dir under a temporary name, flushes
// it, and renames it onto path, so a crash leaves either the old file or the
// complete new one — never a correctly named file whose contents were lost.
//
// pattern is an os.CreateTemp pattern; it names the file only while it is
// being written, so it exists to make an interrupted write recognisable.
func replaceFileDurable(dir, pattern, path string, payload []byte) error {
	temp, err := os.CreateTemp(dir, pattern)
	if err != nil {
		return fmt.Errorf("talk: temp file in %s: %w", dir, err)
	}
	tempName := temp.Name()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempName)
		return fmt.Errorf("talk: write %s: %w", path, err)
	}
	// The flush that closes the window. Without it the rename below can be
	// durable while these bytes are not.
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempName)
		return fmt.Errorf("talk: flush %s: %w", path, err)
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempName)
		return fmt.Errorf("talk: close %s: %w", path, err)
	}
	if err := os.Rename(tempName, path); err != nil {
		_ = os.Remove(tempName)
		return fmt.Errorf("talk: replace %s: %w", path, err)
	}
	syncDir(dir)
	return nil
}

// syncDir flushes the directory entry a rename just changed. It is best effort
// on purpose: Windows refuses FlushFileBuffers on a directory handle, and NTFS
// journals the rename anyway, so a failure here is not a failed write. The
// flush that matters — the file's own bytes — already succeeded above.
func syncDir(dir string) {
	handle, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = handle.Sync()
	_ = handle.Close()
}

// syncFile flushes an already-open file, naming what failed if it did.
func syncFile(file *os.File, what string) error {
	if err := file.Sync(); err != nil {
		return fmt.Errorf("talk: flush %s: %w", what, err)
	}
	return nil
}

// holdsNUL reports whether text contains a NUL byte.
//
// Nothing this store writes ever does. So a NUL in a record is not the prefix
// of a half-written one — it is a record whose bytes were lost. The two look
// alike to a JSON decoder and must not be treated alike: an interrupted append
// may be discarded, lost data may not be.
func holdsNUL(text string) bool { return strings.IndexByte(text, 0) >= 0 }

// quarantineCorruptFile moves an undecodable file aside and returns where it
// went (empty if it could not be moved). Recovery that deletes the evidence
// leaves nobody able to say what happened, so the bytes are kept even though
// nothing will read them again.
func quarantineCorruptFile(path string) string {
	kept := fmt.Sprintf("%s.corrupt-%d", path, time.Now().UnixMilli())
	if err := os.Rename(path, kept); err != nil {
		return ""
	}
	return kept
}

// SetLogger gives the store somewhere to report damage it recovered from
// silently. Call it before serving; it is not safe to change afterwards. A
// store with no logger still recovers, it just does so unobserved.
func (s *Store) SetLogger(logger *log.Logger) { s.logger = logger }

func (s *Store) warnf(format string, args ...any) {
	if s.logger == nil {
		return
	}
	s.logger.Printf(format, args...)
}
