//go:build !windows && !linux

package discovery

// enumerate has no adapter on this platform yet. Returning ErrUnsupported
// rather than an empty slice is the whole point: the operator has to be able to
// tell "this node has no I/O devices" from "this node cannot look".
func enumerate() ([]Found, error) {
	return nil, ErrUnsupported
}
