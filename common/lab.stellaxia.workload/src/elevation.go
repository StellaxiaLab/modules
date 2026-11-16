package main

// Q-14 / O8 (ADR D-27): a workload must never run with more authority than the
// node's user. This module is launched by the Daemon and inherits its token, so
// the module's own elevation IS the Daemon's. If it is elevated (a Windows
// "Highest" task, Linux root), registering or running a program here would hand
// a same-user, unelevated caller an admin-run binary of their choosing — the
// escalation the elevated-daemon report describes. So those calls refuse until
// the Daemon is de-privileged (the track that decided D-27), at which point
// this check passes by itself.

const elevatedMessage = "the Terra daemon runs elevated (Windows administrator / Linux root), " +
	"so a registered program would run with more authority than the node's user; " +
	"workloads are refused until the daemon runs unelevated (Q-14, D-27)"

// elevationCheck reports whether this process holds more than a plain user's
// authority. It is a variable so tests can drive both answers.
var elevationCheck = processElevated
