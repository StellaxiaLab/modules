package weave

// D-15: no injection into a locked session.
//
// The decision is asymmetric on purpose, because the two platforms fail in
// opposite directions. Windows CANNOT inject into the Secure Desktop — the
// lock screen and the UAC prompt live there and no ordinary process reaches
// them — so the rule there is about telling the person why their input stopped.
// Linux CAN. uinput is a kernel device, so a projected pointer types into a
// lock screen exactly as a physical one does, which means a node that
// projected another node's mouse would let the far end unlock this machine.
// That is not a feature to leave switched on by default.
//
// What can be measured without a display server is narrow, and the gate is
// shaped around that narrowness rather than around what would be ideal:
//
//   - A session that says it is locked blocks injection.
//   - No session at all does not. A headless node running at a tty has no lock
//     screen, so there is nothing to bypass; refusing there would disable the
//     whole axis on every node this fleet actually has.
//
// The gate can therefore be wrong in one direction only — it can fail to
// notice a lock it cannot see — and it says which of the two answers it gave.
// "Not locked" and "no session to ask" are different facts and the reason
// string keeps them apart, so a node that looks permissive can be checked
// rather than assumed safe.

// lockState is what the node could determine about its own session.
type lockState struct {
	// Locked is true only when something positively said so.
	Locked bool
	// Reason is what was consulted and what it said.
	Reason string
}

// checkLockState reports whether this node's session is locked. The
// implementation is per platform; every platform has one, because a platform
// that cannot answer must say so rather than have the caller assume.
func checkLockState() lockState { return platformLockState() }
