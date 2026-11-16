package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// maxLogBytes bounds one workload's current log; one rotated copy is kept, so a
// chatty program costs at most twice this and cannot push the daemon's own
// diagnostics out (FR-D2).
const maxLogBytes = 2 << 20

// rotatingLog is the io.Writer a program's stdout and stderr both go to.
type rotatingLog struct {
	mu   sync.Mutex
	path string
	max  int64
	f    *os.File
	size int64
}

func newRotatingLog(dir string, max int64) (*rotatingLog, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	l := &rotatingLog{path: filepath.Join(dir, "current.log"), max: max}
	return l, l.open()
}

func (l *rotatingLog) open() error {
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	l.f, l.size = f, info.Size()
	return nil
}

func (l *rotatingLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return len(p), nil
	}
	if l.size+int64(len(p)) > l.max && l.size > 0 {
		l.f.Close()
		_ = os.Remove(l.path + ".1")
		_ = os.Rename(l.path, l.path+".1")
		if err := l.open(); err != nil {
			l.f = nil
			return len(p), nil
		}
	}
	n, err := l.f.Write(p)
	l.size += int64(n)
	if err != nil {
		return len(p), nil // a full disk must not kill the program being logged
	}
	return n, nil
}

func (l *rotatingLog) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return nil
	}
	err := l.f.Close()
	l.f = nil
	return err
}

// readLog answers one logs.read call. With tail > 0 it returns the last tail
// lines; otherwise everything after the cursor. The returned cursor is the
// current file's size, so `--after <cursor>` is a follow. A cursor past the end
// means the file rotated since: the read restarts at 0 and says so.
func readLog(dir string, tail int, after int64) (text string, cursor int64, rotated bool, err error) {
	f, err := os.Open(filepath.Join(dir, "current.log"))
	if os.IsNotExist(err) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", 0, false, err
	}
	size := info.Size()
	if tail > 0 {
		data, err := io.ReadAll(f)
		if err != nil {
			return "", 0, false, err
		}
		lines := bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
		if len(data) == 0 {
			return "", size, false, nil
		}
		if len(lines) > tail {
			lines = lines[len(lines)-tail:]
		}
		return string(bytes.Join(lines, []byte("\n"))) + "\n", size, false, nil
	}
	if after > size {
		after, rotated = 0, true
	}
	if _, err := f.Seek(after, io.SeekStart); err != nil {
		return "", 0, false, err
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return "", 0, false, err
	}
	return string(data), size, rotated, nil
}
