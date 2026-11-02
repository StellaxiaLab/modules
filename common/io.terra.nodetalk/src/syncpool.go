package main

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

// Peers used to be synced one after another, so a peer that answered slowly —
// or not at all, up to the door's 15 s ceiling per call — held every peer
// behind it for the whole wait, tick after tick. Now each tick syncs peers on a
// bounded pool, gives each one a time budget, and lets a peer that keeps
// failing sit out a few ticks instead of being re-asked every one.

const (
	// maxSyncParallel bounds how many peers one tick talks to at once: enough
	// that one stuck peer does not stall the rest, few enough that a large fleet
	// is not a burst on the relay.
	maxSyncParallel = 4
	// backoffCap bounds how long a failing peer sits out. It stays under the
	// lease window (talk.DefaultLeaseTTL + grace) so a main that comes back is
	// noticed before a challenger has had time to stop waiting for it.
	backoffCap = 30 * time.Second
	// backoffJitter spreads retries so peers that failed together do not all
	// come back on the same tick: the delay is scaled by 1±backoffJitter.
	backoffJitter = 0.2
)

// peerBackoff is one peer's retry schedule. The first failure costs nothing —
// one dropped call is noise, and a partition that heals should heal fast — the
// second and later wait interval·2^(n-2), capped.
type peerBackoff struct {
	failures int
	failedAt time.Time
	retryAt  time.Time
}

func (l *syncLoop) clock() time.Time {
	if l.now != nil {
		return l.now()
	}
	return time.Now()
}

// backoffDelay is how long a peer with n consecutive failures sits out.
func (l *syncLoop) backoffDelay(failures int) time.Duration {
	if failures < 2 {
		return 0
	}
	limit := backoffCap
	if l.interval > limit {
		limit = l.interval
	}
	delay := l.interval
	for i := 2; i < failures && delay < limit; i++ {
		delay *= 2
	}
	if delay > limit {
		delay = limit
	}
	scale := 1 + backoffJitter*(2*rand.Float64()-1)
	return time.Duration(float64(delay) * scale)
}

// dueForSync reports whether peer should be asked on this tick. A peer in
// backoff is skipped — unless it has contacted us since it last failed, which
// proves it is back and makes waiting pointless.
func (l *syncLoop) dueForSync(peer string) bool {
	l.mu.Lock()
	state := l.backoff[peer]
	l.mu.Unlock()
	if state == nil || state.failures == 0 || !l.clock().Before(state.retryAt) {
		return true
	}
	return l.learned.heardSince(peer, state.failedAt)
}

func (l *syncLoop) recordPeerResult(peer string, ok bool) (failures int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ok {
		delete(l.backoff, peer)
		return 0
	}
	if l.backoff == nil {
		l.backoff = map[string]*peerBackoff{}
	}
	state := l.backoff[peer]
	if state == nil {
		state = &peerBackoff{}
		l.backoff[peer] = state
	}
	state.failures++
	state.failedAt = l.clock()
	state.retryAt = state.failedAt.Add(l.backoffDelay(state.failures))
	return state.failures
}

// syncPeers syncs every due peer concurrently on a bounded pool and returns
// when all have finished or run out of budget.
func (l *syncLoop) syncPeers(ctx context.Context, peers []string, selfID string) {
	width := l.parallel
	if width <= 0 {
		width = maxSyncParallel
	}
	budget := l.peerBudget
	if budget <= 0 {
		budget = 2 * l.interval
	}
	slots := make(chan struct{}, width)
	var wg sync.WaitGroup
	for _, peer := range peers {
		if peer == selfID || !l.dueForSync(peer) {
			continue
		}
		wg.Add(1)
		go func(peer string) {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				return
			}
			// The budget starts when the peer gets a slot, not when it queued: a
			// peer must not be punished for waiting behind others.
			peerCtx, cancel := context.WithTimeout(ctx, budget)
			defer cancel()
			askPeerName(peerCtx, l.door, l.names, peer)
			err := l.syncPeer(peerCtx, peer, selfID)
			if err == nil && peerCtx.Err() != nil && ctx.Err() == nil {
				err = peerCtx.Err()
			}
			if ctx.Err() != nil {
				return // shutting down is not the peer's failure
			}
			if err != nil {
				failures := l.recordPeerResult(peer, false)
				l.logger.Printf("peer %s: %v (failure %d)", peer, err, failures)
				return
			}
			l.recordPeerResult(peer, true)
		}(peer)
	}
	wg.Wait()
}
