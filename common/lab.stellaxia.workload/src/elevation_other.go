//go:build !windows

package main

import "os"

func processElevated() (bool, error) { return os.Geteuid() == 0, nil }
