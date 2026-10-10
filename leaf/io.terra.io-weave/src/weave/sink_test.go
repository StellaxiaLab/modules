package weave

import (
	"context"
	"errors"
	"testing"

	ioweave "github.com/StellaxiaLab/modules/leaf/io.terra.io-weave/ioweave"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
	protocol "github.com/StellaxiaLab/terra-sdk/protocol"
)

// "Not mine" is not a failure: the daemon asks every registered backend in
// turn, and a module claiming an endpoint it does not serve would take frames
// away from the backend that does.
func TestOpenSinkDeclinesEndpointsItDoesNotOwn(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileShell)
	for name, address := range map[string][2]string{
		"another module's resource": {"svi.node-a.io.mouse-1", PointerEndpointID},
		"module-local id":           {PointerResourceID, PointerEndpointID},
		"an endpoint added later":   {"svi.node-a." + PointerResourceID, "feedback"},
	} {
		sink, err := projection.OpenSink(context.Background(), address[0], address[1])
		if !errors.Is(err, modulesdk.ErrSVISinkNotServed) || sink != nil {
			t.Fatalf("%s: OpenSink = (%v, %v), want ErrSVISinkNotServed", name, sink, err)
		}
	}
	if projection.State().Bound {
		t.Fatal("a declined open claimed the projection anyway")
	}
}

func TestOpenSinkCarriesFramesIntoTheProjection(t *testing.T) {
	projection := newTestProjection(t, ioweave.ProfileTmux)
	sink, err := projection.OpenSink(context.Background(), "svi.node-b."+PointerResourceID, PointerEndpointID)
	if err != nil {
		t.Fatal(err)
	}
	if !projection.State().Bound {
		t.Fatal("an open sink did not claim the projection")
	}
	if err := sink.Write(1, frame(t, protocol.PointerEvent{ScrollY: 1})); err != nil {
		t.Fatal(err)
	}
	if state := projection.State(); state.Applied != 1 {
		t.Fatalf("applied = %d after one frame", state.Applied)
	}

	// A second open while the first holds it is refused with a reason, not
	// with "not mine": the difference is what tells an operator whether to
	// look at the wiring or at who else is holding the pointer.
	second, err := projection.OpenSink(context.Background(), "svi.node-b."+PointerResourceID, PointerEndpointID)
	if second != nil || !errors.Is(err, ErrAlreadyBound) {
		t.Fatalf("second open = (%v, %v), want ErrAlreadyBound", second, err)
	}
	if errors.Is(err, modulesdk.ErrSVISinkNotServed) {
		t.Fatal("a busy pointer must not answer 'not mine' — the daemon would go on looking for another backend")
	}

	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}
	if projection.State().Bound {
		t.Fatal("close did not release the projection")
	}
}
