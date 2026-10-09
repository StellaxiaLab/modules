package main

import (
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
)

// The bootstrap hole this closes: sync is pull-only, and a node builds its peer
// set from the members of conversations it ALREADY holds (sync.go tick). An
// invited node holds nothing, so it asks nobody, so it never learns it was
// invited — AddMember only writes the inviter's own store. The first
// conversation between two nodes could not cross on its own, and an operator
// had to seed peers.json by hand for a door that was already open.
//
// The missing signal was already arriving. The main's sync loop pulls from
// every active member every tick, so from the moment of the invite the
// invitee's door is being knocked on every 10 seconds. It just learned nothing
// from being knocked on.
//
// So: a node that knocks is a node worth asking back. The origin is not
// self-reported — the Master stamps X-Terra-Principal from the authenticated
// relay session and discards whatever identity the payload carried
// (modulecatalog.PeerModulePrincipal) — so this hint is exactly as trustworthy
// as the door it arrived through.
//
// The hint carries no conversation data, only a name to ask. Every fact still
// arrives by this node's own pull and is still gated by the same membership
// check, so the pull-only trust model is untouched: learning a peer widens who
// this node ASKS, never what it believes.
//
// The set is memory-only on purpose. A restart forgets it, and the next knock
// — at most one interval away — teaches it again; once the conversation is
// adopted, ActiveMemberPeers carries the peer for good. Persisting it would add
// a file to reason about and buy nothing.

// learnedPeerLimit bounds the set. A knock costs the knocker a relay roundtrip,
// which is throttle enough for the fleets this module serves, but an unbounded
// map on a large one is still not something to leave lying around.
const learnedPeerLimit = 256

type peerLearner struct {
	mu    sync.Mutex
	peers map[string]bool
}

func newPeerLearner() *peerLearner {
	return &peerLearner{peers: map[string]bool{}}
}

// learn records one origin, reporting whether it was new — the caller logs
// only the transition, not every knock.
func (l *peerLearner) learn(node string) bool {
	if l == nil || !talk.ValidNodeID(node) {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.peers[node] || len(l.peers) >= learnedPeerLimit {
		return false
	}
	l.peers[node] = true
	return true
}

// known answers the learned set in a stable order.
func (l *peerLearner) known() []string {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	peers := make([]string, 0, len(l.peers))
	for peer := range l.peers {
		peers = append(peers, peer)
	}
	sort.Strings(peers)
	return peers
}

// learnPeerMiddleware records the origin of every door-relayed request. It is
// mounted BEHIND the fault middleware so a force_offline partition refuses the
// request before anything is learned — a cut node must not become discoverable
// by knocking on a door that is refusing it.
func learnPeerMiddleware(learner *peerLearner, logger *log.Logger, next http.Handler) http.Handler {
	if learner == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := r.Header.Get("X-Terra-Principal")
		if strings.HasPrefix(principal, peerPrincipalPrefix) {
			if origin := strings.TrimPrefix(principal, peerPrincipalPrefix); learner.learn(origin) && logger != nil {
				logger.Printf("learned peer %s — it knocked, so it is worth asking back", origin)
			}
		}
		next.ServeHTTP(w, r)
	})
}
