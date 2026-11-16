//go:build windows

package main

import "os"

// Windows has no execute bit; whether a file runs is decided by its type at
// launch, and the launch error is reported then.
func executableMode(info os.FileInfo) bool { return info.Mode().IsRegular() }
