//go:build !windows

package main

import "os"

func executableMode(info os.FileInfo) bool {
	return info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}
