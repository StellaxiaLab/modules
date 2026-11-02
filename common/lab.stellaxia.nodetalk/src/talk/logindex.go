package talk

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// A log summary is what the write path needs from an author log: the last seq
// (the watermark), the highest lamport, and the idempotency keys. Computing it
// by parsing the whole file made every append — and every watermark read that
// Get, List and the sync loop make — cost the length of the conversation, all
// under the store lock. Logs are append-only, so the summary is kept per file
// and only the bytes added since it was last read are parsed.
//
// The cache is an optimisation of readLog, never a second source of truth: it
// is rebuilt from scratch whenever the file is not what the cache last saw
// (shorter, gone, or its last known line differs), and a file readLog would
// refuse is refused here with the same error.

// logTailProbe is how many bytes before the verified end are remembered, to
// notice a file that was replaced rather than appended to.
const logTailProbe = 256

type logSummary struct {
	lastSeq    int
	maxLamport int
	keyed      map[string]Entry // entries that carry an idempotency key
}

type logIndex struct {
	logSummary
	validEnd int64  // byte offset just past the last well-formed line
	tail     []byte // up to logTailProbe bytes ending at validEnd
}

// summarizeLogLocked returns the summary of one author log. A missing file is
// an empty summary, like readLog's empty result. Callers hold s.mu.
func (s *Store) summarizeLogLocked(path string) (logSummary, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		delete(s.logIdx, path)
		return logSummary{}, nil
	}
	if err != nil {
		return logSummary{}, fmt.Errorf("talk: open log: %w", err)
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return logSummary{}, fmt.Errorf("talk: stat log: %w", err)
	}
	idx := s.logIdx[path]
	if idx != nil && !idx.stillPrefixOf(file, info.Size()) {
		idx = nil
	}
	if idx == nil {
		idx = &logIndex{logSummary: logSummary{keyed: map[string]Entry{}}}
	}
	if err := idx.extend(file, path, info.Size()); err != nil {
		delete(s.logIdx, path)
		return logSummary{}, err
	}
	if s.logIdx == nil {
		s.logIdx = map[string]*logIndex{}
	}
	s.logIdx[path] = idx
	return idx.logSummary, nil
}

// stillPrefixOf reports whether the bytes this index verified are still the
// start of the file.
func (idx *logIndex) stillPrefixOf(file *os.File, size int64) bool {
	if size < idx.validEnd {
		return false
	}
	if len(idx.tail) == 0 {
		return idx.validEnd == 0
	}
	probe := make([]byte, len(idx.tail))
	if _, err := file.ReadAt(probe, idx.validEnd-int64(len(probe))); err != nil {
		return false
	}
	return bytes.Equal(probe, idx.tail)
}

// extend parses what was appended after validEnd, applying readLog's rules: a
// malformed FINAL line is a torn append and is left unconsumed (it may yet be
// completed or replaced), NUL bytes are lost data, and a malformed line with
// content after it is corruption.
func (idx *logIndex) extend(file *os.File, path string, size int64) error {
	if size == idx.validEnd {
		return nil
	}
	if _, err := file.Seek(idx.validEnd, io.SeekStart); err != nil {
		return fmt.Errorf("talk: read log %s: %w", path, err)
	}
	reader := bufio.NewReader(file)
	offset := idx.validEnd
	var last []byte // bytes of the last consumed line, for the tail probe
	malformedAt := int64(-1)
	malformedLost := false
	lineNo := 0
	for {
		raw, readErr := reader.ReadBytes('\n')
		if len(raw) > 0 {
			lineNo++
			text := bytes.TrimSpace(raw)
			if len(text) > 0 {
				if malformedAt >= 0 {
					return fmt.Errorf("talk: corrupt log %s: unreadable line after byte %d is not the tail", path, malformedAt)
				}
				var line storedEntry
				if err := json.Unmarshal(text, &line); err != nil {
					malformedAt = offset
					malformedLost = bytes.IndexByte(text, 0) >= 0
				} else {
					idx.lastSeq = line.Seq
					if line.Lamport > idx.maxLamport {
						idx.maxLamport = line.Lamport
					}
					if line.IdempotencyKey != "" {
						idx.keyed[line.IdempotencyKey] = line.Entry
					}
					offset += int64(len(raw))
					idx.validEnd = offset
					last = raw
				}
			} else if malformedAt < 0 {
				// A blank line is consumed so it is not re-read forever.
				offset += int64(len(raw))
				idx.validEnd = offset
				last = raw
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				return fmt.Errorf("talk: read log %s: %w", path, readErr)
			}
			break
		}
	}
	if malformedLost {
		return fmt.Errorf("talk: corrupt log %s: line at byte %d holds NUL bytes — its contents were lost, not half-written", path, malformedAt)
	}
	if last != nil {
		idx.tail = tailOf(file, idx.validEnd)
	}
	return nil
}

func tailOf(file *os.File, end int64) []byte {
	n := int64(logTailProbe)
	if end < n {
		n = end
	}
	buf := make([]byte, n)
	if _, err := file.ReadAt(buf, end-n); err != nil {
		return nil
	}
	return buf
}
