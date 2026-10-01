package weave

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	modulesdk "github.com/terra-project/terra/products/common/packages/terra-module-sdk"
)

// OpenSink is the module's answer to "can you absorb a binding's frames for
// this endpoint".
//
// Three answers, and they are deliberately different from each other:
//
//   - not mine (ErrSVISinkNotServed) — another backend may own it, and the
//     daemon goes on asking. Not an error anywhere.
//   - mine and busy — one remote pointer per node, so a second binding is
//     refused with a reason the binding's status carries.
//   - mine and open — the projection is claimed until close.
//
// The endpoint id is checked as well as the resource id. A resource with a
// second endpoint added later must not silently inherit this sink: the frames
// would arrive shaped for something else and be refused one at a time, which
// reads as a flaky link rather than a wiring mistake.
func (p *Projection) OpenSink(_ context.Context, resourceID, endpointID string) (modulesdk.SVISink, error) {
	if !OwnsResource(resourceID) || endpointID != PointerEndpointID {
		return nil, modulesdk.ErrSVISinkNotServed
	}
	id, err := newSinkID()
	if err != nil {
		return nil, err
	}
	if err := p.Attach(id); err != nil {
		return nil, err
	}
	return &pointerSink{projection: p, id: id}, nil
}

// newSinkID names one open sink. The daemon has its own id for the sink it
// opened and the binding has a third; this one exists so Detach can tell "the
// binding that holds the projection" from "a late close of the one before it".
func newSinkID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("io-weave: allocate sink id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

type pointerSink struct {
	projection *Projection
	id         string
}

func (s *pointerSink) Write(sequence uint64, data []byte) error {
	return s.projection.Apply(sequence, data)
}

func (s *pointerSink) Close() error {
	s.projection.Detach(s.id)
	return nil
}
