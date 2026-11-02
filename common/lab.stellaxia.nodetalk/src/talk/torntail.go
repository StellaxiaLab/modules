package talk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// maxTornTail bounds how much unterminated tail dropTornTail will look back
// over. An entry is at most a few KB, so a longer unterminated run is not a
// torn append and is refused rather than cut.
const maxTornTail = 64 * 1024

// dropTornTail leaves file positioned at its end with no unterminated
// fragment before it. An interrupted append leaves a prefix of the line with no
// newline; appending after it would glue the next, acknowledged line onto the
// fragment and make both unreadable — the new message lost although the caller
// was told it was stored. The fragment was never acknowledged (the append that
// wrote it did not return), so it is cut. A complete line that merely lacks its
// newline is kept and terminated.
func dropTornTail(file *os.File, path string) error {
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("talk: stat log %s: %w", path, err)
	}
	size := info.Size()
	if size == 0 {
		return nil
	}
	window := int64(maxTornTail)
	if size < window {
		window = size
	}
	buf := make([]byte, window)
	if _, err := file.ReadAt(buf, size-window); err != nil {
		return fmt.Errorf("talk: read log tail %s: %w", path, err)
	}
	if buf[len(buf)-1] == '\n' {
		_, err := file.Seek(0, io.SeekEnd)
		return err
	}
	cut := bytes.LastIndexByte(buf, '\n')
	if cut < 0 && window < size {
		return fmt.Errorf("talk: log %s ends in an unterminated run longer than %d bytes", path, maxTornTail)
	}
	fragment := bytes.TrimSpace(buf[cut+1:])
	if bytes.IndexByte(fragment, 0) >= 0 {
		return fmt.Errorf("talk: corrupt log %s: unterminated tail holds NUL bytes — its contents were lost, not half-written", path)
	}
	var whole storedEntry
	if json.Unmarshal(fragment, &whole) == nil {
		if _, err := file.Seek(0, io.SeekEnd); err != nil {
			return err
		}
		_, err := file.Write([]byte{'\n'})
		return err
	}
	keep := size - window + int64(cut+1)
	if err := file.Truncate(keep); err != nil {
		return fmt.Errorf("talk: drop torn tail of %s: %w", path, err)
	}
	_, err = file.Seek(0, io.SeekEnd)
	return err
}
