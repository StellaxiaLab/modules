package main

import (
	"context"
	"encoding/json"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/terra-project/terra/module/common/io.terra.nodetalk/talk"
)

// Fault injection (plan §3 M5, idea doc §9). Without this, the failover and
// tombstone code only ever runs when an accident happens — and accidents do
// not happen during demos. The knobs make the accidents on purpose: delay,
// drop, forced offline (a REAL partition for door traffic, both directions),
// and live overrides for the settle/hysteresis pacing so flapping can be
// reproduced instead of imagined.
//
// D-7 (mechanism): the surface exists only when TERRA_NODETALK_FAULTS=1 is in
// the module's environment — a dev-assembly gate the operator sets, never a
// runtime toggle a caller could reach. Shipped assemblies without the variable
// answer FAULTS_NOT_AVAILABLE (404) and status reports faults_enabled:false.
// State lives in process memory only (the contract's stated semantics): a
// restart clears every fault.

const envFaultsEnabled = "TERRA_NODETALK_FAULTS"

// faultRule is one target's injected behaviour.
type faultRule struct {
	DelayMS      int
	DropRate     float64
	ForceOffline bool
}

func (r faultRule) zero() bool {
	return r.DelayMS == 0 && r.DropRate == 0 && !r.ForceOffline
}

type faultState struct {
	mu      sync.Mutex
	enabled bool
	global  faultRule
	byNode  map[string]faultRule
	// pacing overrides; nil = not overridden
	settleMS     *int
	hysteresisMS *int
	rng          *rand.Rand
}

func newFaultState() *faultState {
	return &faultState{
		enabled: strings.TrimSpace(os.Getenv(envFaultsEnabled)) == "1",
		byNode:  map[string]faultRule{},
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (f *faultState) Enabled() bool {
	if f == nil {
		return false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.enabled
}

// ruleFor combines the global rule with the node's own (the stronger of each
// knob wins).
func (f *faultState) ruleFor(node string) faultRule {
	f.mu.Lock()
	defer f.mu.Unlock()
	rule := f.global
	if specific, known := f.byNode[node]; known {
		if specific.DelayMS > rule.DelayMS {
			rule.DelayMS = specific.DelayMS
		}
		if specific.DropRate > rule.DropRate {
			rule.DropRate = specific.DropRate
		}
		rule.ForceOffline = rule.ForceOffline || specific.ForceOffline
	}
	return rule
}

func (f *faultState) roll(rate float64) bool {
	if rate <= 0 {
		return false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.rng.Float64() < rate
}

func (f *faultState) settleOverride() (time.Duration, bool) {
	if f == nil {
		return 0, false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settleMS == nil {
		return 0, false
	}
	return time.Duration(*f.settleMS) * time.Millisecond, true
}

func (f *faultState) hysteresisOverride() (time.Duration, bool) {
	if f == nil {
		return 0, false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.hysteresisMS == nil {
		return 0, false
	}
	return time.Duration(*f.hysteresisMS) * time.Millisecond, true
}

func (f *faultState) activeCount() int {
	count := 0
	if !f.global.zero() {
		count++
	}
	for _, rule := range f.byNode {
		if !rule.zero() {
			count++
		}
	}
	if f.settleMS != nil {
		count++
	}
	if f.hysteresisMS != nil {
		count++
	}
	return count
}

// faultDoor injects the outbound faults in front of the real door. A dropped
// or offline call fails with its own code, so the sync log and the diag
// drawer say "injected", never "the network did that".
func faultDoor(state *faultState, inner doorFunc) doorFunc {
	if state == nil {
		return inner
	}
	return func(ctx context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		if state.Enabled() {
			rule := state.ruleFor(node)
			if rule.ForceOffline {
				return nil, &doorError{Code: "FAULT_FORCED_OFFLINE", Message: "fault: " + node + " is forced offline"}
			}
			if rule.DelayMS > 0 {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(time.Duration(rule.DelayMS) * time.Millisecond):
				}
			}
			if state.roll(rule.DropRate) {
				return nil, &doorError{Code: "FAULT_INJECTED_DROP", Message: "fault: dropped by injected rate"}
			}
		}
		return inner(ctx, node, method, path, body)
	}
}

// faultInboundMiddleware makes force_offline a real partition: door-relayed
// requests FROM the offlined node (identified by the Master-stamped principal)
// are refused too, so neither direction of module traffic crosses the cut.
// User/GUI traffic is untouched — the screens keep working while the modules
// cannot see each other, which is exactly the test bench's job.
func faultInboundMiddleware(state *faultState, next http.Handler) http.Handler {
	if state == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if state.Enabled() {
			if principal := r.Header.Get("X-Terra-Principal"); strings.HasPrefix(principal, peerPrincipalPrefix) {
				origin := strings.TrimPrefix(principal, peerPrincipalPrefix)
				if state.ruleFor(origin).ForceOffline {
					writeAPIError(w, http.StatusServiceUnavailable, "NODETALK_UNAVAILABLE",
						"fault: force_offline — "+origin+"에서 오는 트래픽을 받지 않는다")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// faultsSet answers io.terra.nodetalk.faults.set. Dev assemblies only (D-7).
func (s *apiServer) faultsSet(w http.ResponseWriter, r *http.Request) {
	state := s.deps.Faults
	if state == nil || !state.Enabled() {
		writeAPIError(w, http.StatusNotFound, "FAULTS_NOT_AVAILABLE",
			"이 조립에는 고장 주입 표면이 없다 ("+envFaultsEnabled+"=1인 개발 조립 전용)")
		return
	}
	var body struct {
		DelayMS              *int     `json:"delay_ms"`
		DropRate             *float64 `json:"drop_rate"`
		ForceOffline         *bool    `json:"force_offline"`
		HandoverHysteresisMS *int     `json:"handover_hysteresis_ms"`
		SettleMS             *int     `json:"settle_ms"`
		TargetNodeID         string   `json:"target_node_id"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.TargetNodeID != "" {
		// A fault is aimed at a node, and a node is named the same way here as
		// everywhere else. This route is reached by hand during a test run, which
		// is exactly when typing a full node id is most annoying and most likely
		// to go to the wrong machine unnoticed.
		target, err := s.nodeReference(body.TargetNodeID, s.deps.ResolveNodeID(r.Context()), false)
		if err != nil {
			s.writeStoreError(w, r, err)
			return
		}
		if !talk.ValidNodeID(target) {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "target_node_id가 올바르지 않다")
			return
		}
		body.TargetNodeID = target
	}
	rule := faultRule{}
	if body.DelayMS != nil {
		if *body.DelayMS < 0 || *body.DelayMS > 60000 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "delay_ms는 0..60000이어야 한다")
			return
		}
		rule.DelayMS = *body.DelayMS
	}
	if body.DropRate != nil {
		if *body.DropRate < 0 || *body.DropRate > 1 {
			writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "drop_rate는 0..1이어야 한다")
			return
		}
		rule.DropRate = *body.DropRate
	}
	if body.ForceOffline != nil {
		rule.ForceOffline = *body.ForceOffline
	}

	state.mu.Lock()
	// A PUT replaces the addressed scope's rule with exactly what it carries —
	// clearing is a PUT with the target and nothing else.
	if body.TargetNodeID != "" {
		if rule.zero() {
			delete(state.byNode, body.TargetNodeID)
		} else {
			state.byNode[body.TargetNodeID] = rule
		}
	} else {
		state.global = rule
		if body.SettleMS != nil {
			if *body.SettleMS < 0 {
				state.mu.Unlock()
				writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "settle_ms는 0 이상이어야 한다")
				return
			}
			state.settleMS = body.SettleMS
		}
		if body.HandoverHysteresisMS != nil {
			if *body.HandoverHysteresisMS < 0 {
				state.mu.Unlock()
				writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "handover_hysteresis_ms는 0 이상이어야 한다")
				return
			}
			state.hysteresisMS = body.HandoverHysteresisMS
		}
	}
	active := state.activeCount()
	state.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{"applied": true, "active_faults": active})
}
