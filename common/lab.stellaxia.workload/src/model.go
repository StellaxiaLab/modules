package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Status is the operating-state vocabulary the Local API already shows for
// modules (requirements C-14). A reference registration speaks the same words
// so a list that mixes sources reads as one list.
const (
	StatusStopped     = "stopped"
	StatusStarting    = "starting"
	StatusRunning     = "running"
	StatusStopping    = "stopping"
	StatusFailed      = "failed"
	StatusUnavailable = "unavailable" // registered, but the executable is gone
)

const (
	RestartNever     = "never"
	RestartOnFailure = "on-failure"
	RestartAlways    = "always"
)

const (
	EnvShellSnapshot = "shell-snapshot"
	EnvDeclared      = "declared"
)

// workloadIDPattern is the module id rule (manifest v2); a reference
// registration additionally starts with "local." (D-26) so it can never collide
// with an id published to a tree.
var workloadIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,127}$`)

const localPrefix = "local."

// Workload is the record the module keeps for one registered program. It never
// carries environment VALUES: the snapshot lives in its own user-only file and
// only its key names appear here (NFR-13).
type Workload struct {
	WorkloadID  string    `json:"workload_id"`
	DisplayName string    `json:"display_name"`
	Scope       string    `json:"scope"`
	Driver      string    `json:"driver"`
	Source      Source    `json:"source"`
	Spec        Spec      `json:"spec"`
	Status      string    `json:"status"`
	Instance    *Instance `json:"instance,omitempty"`
	LastExit    *LastExit `json:"last_exit,omitempty"`
	CreatedAt   string    `json:"created_at"`
	UpdatedAt   string    `json:"updated_at"`
}

type Source struct {
	Mode             string `json:"mode"`
	ExecPath         string `json:"exec_path"`
	DigestAtRegister string `json:"digest_at_register"`
	DigestNow        string `json:"digest_now,omitempty"`
	Drift            bool   `json:"drift"`
}

type Spec struct {
	Args       []string `json:"args"`
	WorkingDir string   `json:"working_dir"`
	Env        EnvSpec  `json:"env"`
	Restart    Restart  `json:"restart"`
	AutoStart  bool     `json:"auto_start"`
}

type EnvSpec struct {
	Mode      string            `json:"mode"`
	Keys      []string          `json:"keys"`
	Overrides map[string]string `json:"overrides,omitempty"`
}

type Restart struct {
	Policy      string `json:"policy"`
	MaxRestarts int    `json:"max_restarts"`
	BackoffMs   int    `json:"backoff_ms"`
}

type Instance struct {
	PID          int    `json:"pid"`
	StartedAt    string `json:"started_at"`
	RestartCount int    `json:"restart_count"`
}

type LastExit struct {
	Code   int    `json:"code"`
	Forced bool   `json:"forced"`
	At     string `json:"at"`
}

// apiError carries a contract error code and its HTTP status through the layers.
type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

func errf(status int, code, format string, a ...any) *apiError {
	return &apiError{Status: status, Code: code, Message: fmt.Sprintf(format, a...)}
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

func validateID(id string) error {
	if !workloadIDPattern.MatchString(id) || !strings.HasPrefix(id, localPrefix) {
		return errf(400, "WORKLOAD_ID_INVALID",
			"workload id %q must start with %q and match %s", id, localPrefix, workloadIDPattern)
	}
	return nil
}

// checkExecutable reports the two registration failures a person can fix: no
// such file, or a file that cannot be run.
func checkExecutable(path string) error {
	if !filepath.IsAbs(path) {
		return errf(400, "WORKLOAD_EXEC_NOT_FOUND", "exec path %q must be absolute", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		return errf(400, "WORKLOAD_EXEC_NOT_FOUND", "no file at %q", path)
	}
	if info.IsDir() {
		return errf(400, "WORKLOAD_EXEC_NOT_FOUND", "%q is a directory, not a program", path)
	}
	if !executableMode(info) {
		return errf(400, "WORKLOAD_EXEC_NOT_EXECUTABLE", "%q is not executable", path)
	}
	return nil
}

func fileDigest(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

var errNotFound = errors.New("workload not found")
