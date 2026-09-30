package main

// What to call a node.
//
// Every surface this module has was showing raw ids —
// `node_1787923476493_4c773555dd1dd13d` as the author of a line, and again as
// the subject of "…4c773555 님이 초대되었습니다". A transcript addressed by
// identifiers is a transcript nobody can read, and the room could not fix it on
// its own: it is deliberately blind to what a node is (D-12).
//
// Names come from the nodes themselves, over the door this module already has.
// The alternative was to ask the Master, which knows every node authoritatively
// — and which a LEAF-hosted module cannot reach at all, because the fleet core
// operations live only on the tree host. A name that appears on one product and
// not the other is worse than a name that arrives a tick late.
//
// So each node reports its own name (terra.node.identity.get gained
// display_name), publishes it to peers through status.get, and every node keeps
// what it has heard. The directory is a cache of hearsay, and it is treated as
// one: a name is only ever a label, never an identity. Everything that decides
// anything — membership, ranks, authorship, the peer principal — still runs on
// ids, which are the only thing the Master vouches for.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// directoryRefresh is how long a learned name is trusted before this node asks
// again. Names change when an operator renames a machine, which is rare enough
// that an hour of staleness costs nothing and cheap enough to refresh anyway.
const directoryRefresh = time.Hour

type nodeName struct {
	Name     string `json:"name"`
	LearnedS int64  `json:"learned_s"`
}

// directory maps node ids to what those nodes call themselves.
type directory struct {
	path string

	mu    sync.Mutex
	names map[string]nodeName
}

func newDirectory(root string) *directory {
	d := &directory{path: filepath.Join(root, "nodes.json"), names: map[string]nodeName{}}
	d.load()
	return d
}

func (d *directory) load() {
	raw, err := os.ReadFile(d.path)
	if err != nil {
		return
	}
	var document map[string]nodeName
	if json.Unmarshal(raw, &document) != nil {
		// A corrupt directory is a cache miss, not a failure: every name in it
		// can be learned again, and refusing to start over a cache would be
		// refusing to run over something that does not matter.
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.names = document
}

func (d *directory) saveLocked() {
	encoded, err := json.MarshalIndent(d.names, "", "  ")
	if err != nil {
		return
	}
	temporary := d.path + ".tmp"
	if os.WriteFile(temporary, encoded, 0o600) != nil {
		return
	}
	_ = os.Rename(temporary, d.path)
}

// Learn records what a node calls itself. A name equal to the id is not worth
// storing — that is the fallback, not a name.
func (d *directory) Learn(nodeID, name string) {
	if d == nil || !talk.ValidNodeID(nodeID) || name == "" || name == nodeID {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, known := d.names[nodeID]; known && existing.Name == name {
		existing.LearnedS = time.Now().Unix()
		d.names[nodeID] = existing
		d.saveLocked()
		return
	}
	d.names[nodeID] = nodeName{Name: name, LearnedS: time.Now().Unix()}
	d.saveLocked()
}

// Name answers what to call a node, falling back to its id.
//
// The fallback is the whole reason callers can use this without checking: a
// surface that has to ask "do we know a name?" every time will get it wrong
// somewhere, and the wrong answer is a blank where a speaker should be.
func (d *directory) Name(nodeID string) string {
	if d == nil || nodeID == "" {
		return nodeID
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if known, present := d.names[nodeID]; present && known.Name != "" {
		return known.Name
	}
	return nodeID
}

// NeedsRefresh reports whether this node should ask a peer its name again.
func (d *directory) NeedsRefresh(nodeID string) bool {
	if d == nil {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	known, present := d.names[nodeID]
	if !present {
		return true
	}
	return time.Since(time.Unix(known.LearnedS, 0)) > directoryRefresh
}

// askPeerName learns one peer's name through the door, using the same status
// call an L1 probe measures. Failure is silence: a peer that cannot be reached
// keeps whatever name we last heard, and a node with no name shows its id.
func askPeerName(ctx context.Context, door doorFunc, names *directory, peer string) {
	if door == nil || names == nil || !names.NeedsRefresh(peer) {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	raw, err := door(ctx, peer, "GET", apiPrefix+"/status", nil)
	if err != nil {
		return
	}
	var answer struct {
		NodeID      string `json:"node_id"`
		DisplayName string `json:"display_name"`
	}
	if json.Unmarshal(raw, &answer) != nil {
		return
	}
	// The id the peer reports is not trusted over the one we addressed: the
	// door's principal is what says who answered, and a node that named itself
	// something else would be renaming a stranger.
	names.Learn(peer, answer.DisplayName)
}

// Lookup answers which nodes go by a name. It returns every match rather than
// the first: two nodes can share a name, and picking one of them would resolve
// an ambiguity the caller is better placed to settle.
func (d *directory) Lookup(name string) []string {
	if d == nil || name == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	matches := []string{}
	for nodeID, known := range d.names {
		if known.Name == name {
			matches = append(matches, nodeID)
		}
	}
	sort.Strings(matches)
	return matches
}
