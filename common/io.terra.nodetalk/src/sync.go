package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/StellaxiaLab/modules/common/io.terra.nodetalk/talk"
	modulert "github.com/StellaxiaLab/terra-sdk/modulert"
	modulesdk "github.com/StellaxiaLab/terra-sdk/modulesdk"
)

// The background sync loop — the half of this module that works while nobody
// is watching (plan §3 M2). Every tick it walks its peers through the
// terra.node.peer.invoke door, adopts conversations it is a member of, records
// what each peer holds (the behind number), and pulls the ranges it is
// missing. Pull-only and symmetric: each node pulls for itself, so a
// restarted node catches up by its own hand and no push fan-out is needed.
//
// Peers come from three places: every active member of every local
// conversation; TERRA_NODETALK_PEERS (comma-separated, bench assemblies that
// launch the module directly — a real host's launcher deliberately strips
// non-allowlisted environment); and <data dir>/peers.json (a JSON array of
// node ids), which is the cold-bootstrap seed that works UNDER a real host:
// the operator — or a test — writes it into the module's data home. Discovery
// through the Master's node catalog is deliberately not here (it would widen
// the door's permission surface); recorded as an open item in the plan.

const (
	envSyncIntervalMS = "TERRA_NODETALK_SYNC_INTERVAL_MS"
	envStaticPeers    = "TERRA_NODETALK_PEERS"
	envSettleMS       = "TERRA_NODETALK_SETTLE_MS"

	defaultSyncInterval = 10 * time.Second
	defaultSettle       = 30 * time.Second
	doorCallTimeoutMS   = 10000
)

// doorFunc is one call through the peer door: the module's own surface on
// node, addressed by method+path. It returns the peer module's raw response
// body, or a coded error. Production wraps the Core client; tests dispatch
// straight into another handler.
type doorFunc func(ctx context.Context, node, method, path string, body []byte) (json.RawMessage, error)

// doorError is a coded failure from the peer side, preserved so sync can
// distinguish EPOCH_STALE from NOT_FOUND from unreachable.
type doorError struct {
	Code    string
	Message string
}

func (e *doorError) Error() string { return e.Code + ": " + e.Message }

// coreDoor adapts the SDK Core client into a doorFunc.
func coreDoor(core *modulesdk.CoreClient) doorFunc {
	return func(ctx context.Context, node, method, path string, body []byte) (json.RawMessage, error) {
		input, err := json.Marshal(map[string]any{
			"node_id":    node,
			"method":     method,
			"path":       path,
			"body":       json.RawMessage(body),
			"timeout_ms": doorCallTimeoutMS,
		})
		if err != nil {
			return nil, err
		}
		result, err := core.Invoke(ctx, modulert.CoreInvocation{
			OperationID: "terra.node.peer.invoke",
			Input:       input,
			TimeoutMS:   doorCallTimeoutMS + 5000,
		})
		if err != nil {
			return nil, err
		}
		var output struct {
			Output json.RawMessage `json:"output"`
			Error  *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(result.Output, &output); err != nil {
			return nil, fmt.Errorf("decode door output: %w", err)
		}
		if output.Error != nil {
			return nil, &doorError{Code: output.Error.Code, Message: output.Error.Message}
		}
		return output.Output, nil
	}
}

type syncLoop struct {
	store       *talk.Store
	door        doorFunc
	self        func(context.Context) string
	dataRoot    string // the module data home; peers.json lives here
	staticPeers []string
	interval    time.Duration
	logger      *log.Logger

	// The claim brake (§5.5 settle timer): a node must observe itself
	// continuously eligible — outranking a reachable, caught-up-to main — for
	// settle before it claims. eligibleSince tracks the first observation per
	// conversation; any break resets it.
	settle        time.Duration
	eligibleSince map[string]time.Time

	// faults supplies live pacing overrides (M5); nil-safe.
	faults *faultState
	// learned holds peers discovered from inbound door traffic (peerlearn.go),
	// which is how an invited node finds the first peer to pull from; nil-safe.
	learned *peerLearner
	// names is the node directory (directory.go). The loop fills it from the
	// peers it is already reaching, so learning what to call a node costs one
	// cheap call the first time and nothing after that.
	names *directory
	// mainSeen is when this node last reached each conversation's main. It is
	// the challenger's half of the lease (talk/lease.go): the main stands down
	// after leaseTTL of being unreached, and a challenger waits leaseTTL+grace
	// before taking over, so the seat is empty before anyone sits in it.
	mainSeen map[string]time.Time
	// leaseTTL and leaseGrace pace that. Zero means the package defaults; a
	// negative TTL turns self-promotion off, which is what a bench that wants
	// the old ask-the-main-only behaviour sets.
	leaseTTL   time.Duration
	leaseGrace time.Duration
	// promotionHysteresis paces repeated self-promotions the way §5.5 paces
	// claims. A cooperative claim is paced by the MAIN that accepts it; a
	// self-promotion has no such second party, so the brake has to be here.
	promotionHysteresis time.Duration
	// failCounts tracks consecutive pull failures per conversation|author so a
	// finally-successful pull can stamp how many attempts it truly took.
	failCounts map[string]int
}

func newSyncLoop(store *talk.Store, door doorFunc, self func(context.Context) string, dataRoot string) *syncLoop {
	interval := defaultSyncInterval
	if raw := strings.TrimSpace(os.Getenv(envSyncIntervalMS)); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 250 {
			interval = time.Duration(parsed) * time.Millisecond
		}
	}
	peers := []string{}
	for _, piece := range strings.Split(os.Getenv(envStaticPeers), ",") {
		piece = strings.TrimSpace(piece)
		if piece != "" && talk.ValidNodeID(piece) {
			peers = append(peers, piece)
		}
	}
	settle := defaultSettle
	if raw := strings.TrimSpace(os.Getenv(envSettleMS)); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			settle = time.Duration(parsed) * time.Millisecond
		}
	}
	return &syncLoop{
		store:         store,
		door:          door,
		self:          self,
		dataRoot:      dataRoot,
		staticPeers:   peers,
		interval:      interval,
		logger:        log.New(os.Stderr, "nodetalk-sync: ", log.LstdFlags),
		settle:        settle,
		eligibleSince: map[string]time.Time{},
		failCounts:    map[string]int{},
	}
}

// run ticks until ctx ends. Failures are logged and retried next tick — an
// unreachable peer is a normal state of the world for this module, not a
// reason to stop trying the others.
func (l *syncLoop) run(ctx context.Context) {
	ticker := time.NewTicker(l.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.tick(ctx)
		}
	}
}

// peersFile is the cold-bootstrap seed inside the module's data home. It is
// re-read every tick so an operator can add a peer to a running node.
const peersFile = "peers.json"

// filePeers reads the data-home peer seed; absent or malformed answers none.
func (l *syncLoop) filePeers() []string {
	raw, err := os.ReadFile(filepath.Join(l.dataRoot, peersFile))
	if err != nil {
		return nil
	}
	var listed []string
	if json.Unmarshal(raw, &listed) != nil {
		return nil
	}
	peers := make([]string, 0, len(listed))
	for _, peer := range listed {
		peer = strings.TrimSpace(peer)
		if talk.ValidNodeID(peer) {
			peers = append(peers, peer)
		}
	}
	return peers
}

// tick performs one full sync pass.
func (l *syncLoop) tick(ctx context.Context) {
	selfID := l.self(ctx)
	peers, err := l.store.ActiveMemberPeers()
	if err != nil {
		l.logger.Printf("peer set: %v", err)
		return
	}
	seen := map[string]bool{selfID: true}
	for _, peer := range peers {
		seen[peer] = true
	}
	discovered := append(append([]string{}, l.staticPeers...), l.filePeers()...)
	discovered = append(discovered, l.learned.known()...)
	for _, peer := range discovered {
		if !seen[peer] {
			peers = append(peers, peer)
			seen[peer] = true
		}
	}
	sort.Strings(peers)
	for _, peer := range peers {
		if peer == selfID {
			continue
		}
		askPeerName(ctx, l.door, l.names, peer)
		if err := l.syncPeer(ctx, peer, selfID); err != nil {
			l.logger.Printf("peer %s: %v", peer, err)
		}
	}
	l.takeLapsedMains(selfID)
}

// markMainSeen starts or restarts the clock this node measures the main's
// silence by.
func (l *syncLoop) markMainSeen(id string) {
	if l.mainSeen == nil {
		l.mainSeen = map[string]time.Time{}
	}
	l.mainSeen[id] = time.Now()
}

// takeLapsedMains promotes this node in any conversation whose main has been
// out of reach for longer than its lease plus the grace margin (D-10).
//
// This is the only path that does not ask permission, so every refusal it can
// get is a normal outcome rather than an error: not the highest-ranked member,
// not caught up, inside the hysteresis window. It logs the promotion and stays
// quiet about the refusals — a node that is merely not the one to promote would
// otherwise say so every ten seconds forever.
func (l *syncLoop) takeLapsedMains(selfID string) {
	ttl, grace := l.leaseTTL, l.leaseGrace
	if ttl == 0 {
		ttl = talk.DefaultLeaseTTL
	}
	if grace == 0 {
		grace = talk.DefaultLeaseGrace
	}
	if ttl < 0 {
		return
	}
	summaries, err := l.store.List()
	if err != nil {
		return
	}
	for _, summary := range summaries {
		conversation := summary.Conversation
		id := conversation.ConversationID
		if conversation.MainNodeID == selfID || conversation.MainNodeID == "" {
			continue
		}
		// Never having reached the main is not the same as the main having gone
		// quiet. A node that has never synced with it holds no catch-up proof —
		// PeerMarks would be empty, and an empty proof passes the catch-up check
		// vacuously, which would let a node that has never seen a single line
		// promote itself over a main it never met. Seeding the clock here (which
		// this used to do) turned exactly that into a timer.
		seen, observed := l.mainSeen[id]
		if !observed {
			continue
		}
		if time.Since(seen) < ttl+grace {
			continue
		}
		marks, err := l.store.PeerMarks(id, conversation.MainNodeID)
		if err != nil {
			continue
		}
		if len(marks) == 0 {
			// The main answered once but this node never recorded what it held,
			// so there is nothing to prove catching up against. Wait for a sync
			// that gives one rather than promote on an empty proof.
			continue
		}
		result, err := l.store.PromoteSelf(id, marks, l.promotionHysteresis)
		if err != nil {
			continue
		}
		// Captured before the re-mark, and measured rather than restated. This
		// line used to print (ttl+grace) rounded to seconds — a constant, and
		// one that rounds to "0s" for any lease under half a second. So the one
		// number worth having at the moment a main is unseated, HOW LONG it was
		// actually out of reach, was the one number the line never carried.
		unreached := time.Since(seen)
		l.markMainSeen(id)
		l.logger.Printf("promoted self to main of %s (epoch %d) — %s went unreached for %s",
			id, result.Epoch, result.PreviousMainName, unreached.Round(time.Millisecond))
	}
}

// syncPeer walks one peer: list → adopt → record marks → pull the gaps.
func (l *syncLoop) syncPeer(ctx context.Context, peer, selfID string) error {
	raw, err := l.door(ctx, peer, "GET", apiPrefix+"/conversations", nil)
	if err != nil {
		return fmt.Errorf("list: %w", err)
	}
	var listing struct {
		Conversations []talk.Summary `json:"conversations"`
	}
	if err := json.Unmarshal(raw, &listing); err != nil {
		return fmt.Errorf("decode list: %w", err)
	}

	listed := map[string]bool{}
	for _, summary := range listing.Conversations {
		conversation := summary.Conversation
		listed[conversation.ConversationID] = true
		isMember := false
		for _, member := range conversation.Members {
			if member.NodeID == selfID && member.State == talk.MemberActive {
				isMember = true
				break
			}
		}
		if !isMember {
			continue
		}
		if deleted, err := l.store.IsDeleted(conversation.ConversationID); err == nil && deleted {
			continue // locally tombstoned; a peer still carrying it cannot revive it
		}
		if err := l.syncConversation(ctx, peer, conversation.ConversationID); err != nil {
			l.logger.Printf("peer %s conversation %s: %v", peer, conversation.ConversationID, err)
		}
	}
	l.discoverDeletions(ctx, peer, listed)
	return nil
}

// discoverDeletions is how a member that was OFFLINE during a deletion learns
// of it (idea doc §6): a conversation whose RECORDED MAIN no longer lists it
// gets one direct question, and the answer separates deleted-and-tombstoned
// (410 → accept the intent) from never-had-it (404 → leave it be). Only the
// recorded main's word deletes — the same trust rule as the relayed leg.
func (l *syncLoop) discoverDeletions(ctx context.Context, peer string, listed map[string]bool) {
	summaries, err := l.store.List()
	if err != nil {
		return
	}
	for _, summary := range summaries {
		conversation := summary.Conversation
		id := conversation.ConversationID
		if conversation.MainNodeID != peer || listed[id] {
			continue
		}
		_, err := l.door(ctx, peer, "GET", apiPrefix+"/conversations/"+url.PathEscape(id), nil)
		var coded *doorError
		if err == nil || !errors.As(err, &coded) || coded.Code != "CONVERSATION_DELETED" {
			continue
		}
		if _, err := l.store.AcceptDeletion(id, peer); err != nil {
			l.logger.Printf("accept deletion of %s from %s: %v", id, peer, err)
		} else {
			l.logger.Printf("accepted deletion of %s (learned from main %s)", id, peer)
		}
	}
}

func (l *syncLoop) syncConversation(ctx context.Context, peer, id string) error {
	raw, err := l.door(ctx, peer, "GET", apiPrefix+"/conversations/"+url.PathEscape(id), nil)
	if err != nil {
		return fmt.Errorf("get: %w", err)
	}
	var detail struct {
		Conversation   talk.Conversation `json:"conversation"`
		HighWaterMarks map[string]int    `json:"high_water_marks"`
	}
	if err := json.Unmarshal(raw, &detail); err != nil {
		return fmt.Errorf("decode get: %w", err)
	}

	if _, err := l.store.AdoptConversation(detail.Conversation); err != nil {
		return fmt.Errorf("adopt: %w", err)
	}
	// Reaching the main is what keeps this node from promoting itself. Recorded
	// on the way in, before anything else can fail: what matters is that the
	// main answered, not that everything after it worked.
	if peer == detail.Conversation.MainNodeID {
		l.markMainSeen(id)
	}
	if err := l.store.UpdatePeerMarks(id, peer, detail.HighWaterMarks); err != nil {
		return fmt.Errorf("record marks: %w", err)
	}

	_, mine, err := l.store.Get(id)
	if err != nil {
		return fmt.Errorf("local marks: %w", err)
	}
	authors := make([]string, 0, len(detail.HighWaterMarks))
	for author := range detail.HighWaterMarks {
		authors = append(authors, author)
	}
	sort.Strings(authors)
	for _, author := range authors {
		if author == l.self(ctx) {
			// A node is the authority on its own log and refuses its own lines
			// back (MergeEntries), so pulling them is a round trip that cannot
			// change anything. What it means when this node is missing some is
			// reported instead (Summary.LostOwn).
			continue
		}
		theirSeq := detail.HighWaterMarks[author]
		for mine[author] < theirSeq {
			pulled, err := l.pullRange(ctx, peer, id, author, mine[author], detail.Conversation.Epoch)
			if err != nil {
				return fmt.Errorf("pull %s after %d: %w", author, mine[author], err)
			}
			if pulled == 0 {
				break // the peer answered but moved nothing — do not spin
			}
			_, mine, err = l.store.Get(id)
			if err != nil {
				return err
			}
		}
	}
	return l.considerClaim(ctx, peer, id, detail.Conversation, detail.HighWaterMarks, mine)
}

// considerClaim is the handover's step ①→③ pacing (§5.3, §5.5): after syncing
// WITH THE CURRENT MAIN, if this node outranks it and holds everything it
// holds, start (or continue) the settle clock; once the observation has held
// for the whole settle window, claim epoch+1. Any break — main unreachable
// (we would not be here), fallen behind, rank changed — resets the clock.
func (l *syncLoop) considerClaim(ctx context.Context, peer, id string, view talk.Conversation, theirMarks, mine map[string]int) error {
	selfID := l.self(ctx)
	eligible := peer == view.MainNodeID &&
		rankOf(view, selfID) >= 0 && rankOf(view, view.MainNodeID) >= 0 &&
		rankOf(view, selfID) < rankOf(view, view.MainNodeID) &&
		covers(mine, theirMarks)
	if !eligible {
		delete(l.eligibleSince, id)
		return nil
	}
	settle := l.settle
	if override, overridden := l.faults.settleOverride(); overridden {
		settle = override
	}
	since, observed := l.eligibleSince[id]
	if !observed {
		l.eligibleSince[id] = time.Now()
		if settle > 0 {
			return nil
		}
		since = time.Now()
	}
	if settle > 0 && time.Since(since) < settle {
		return nil
	}

	body, err := json.Marshal(map[string]any{
		"claimant_node_id": selfID,
		"claimed_epoch":    view.Epoch + 1,
		"high_water_marks": mine,
	})
	if err != nil {
		return err
	}
	_, err = l.door(ctx, peer, "POST", apiPrefix+"/conversations/"+url.PathEscape(id)+"/main", body)
	if err != nil {
		// CATCH_UP_INCOMPLETE / HANDOVER_SUPPRESSED / EPOCH_STALE are normal
		// pacing outcomes — next tick pulls more or waits the window out.
		l.logger.Printf("claim %s at %s: %v", id, peer, err)
		return nil
	}
	delete(l.eligibleSince, id)
	l.logger.Printf("claimed main of %s (epoch %d)", id, view.Epoch+1)
	// Adopt the ex-main's raised meta now — it names this node as main, which
	// also opens the local hysteresis window (replica.go adoption rule).
	return l.syncConversationMeta(ctx, peer, id)
}

// syncConversationMeta re-fetches one conversation's view and adopts it.
func (l *syncLoop) syncConversationMeta(ctx context.Context, peer, id string) error {
	raw, err := l.door(ctx, peer, "GET", apiPrefix+"/conversations/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	var detail struct {
		Conversation talk.Conversation `json:"conversation"`
	}
	if err := json.Unmarshal(raw, &detail); err != nil {
		return err
	}
	_, err = l.store.AdoptConversation(detail.Conversation)
	return err
}

// rankOf reports node's ACTIVE rank in view, or -1.
func rankOf(view talk.Conversation, node string) int {
	for _, member := range view.Members {
		if member.NodeID == node && member.State == talk.MemberActive {
			return member.Rank
		}
	}
	return -1
}

// covers reports whether mine holds at least everything theirs does.
func covers(mine, theirs map[string]int) bool {
	for author, seq := range theirs {
		if mine[author] < seq {
			return false
		}
	}
	return true
}

// pullRange fetches one window of one author's log and merges it, stamping the
// arrival instrumentation this loop actually measured: rung L1 (the door rides
// the Master relay) and the roundtrip it took.
func (l *syncLoop) pullRange(ctx context.Context, peer, id, author string, afterSeq, epoch int) (int, error) {
	path := apiPrefix + "/conversations/" + url.PathEscape(id) + "/replica?author_node_id=" +
		url.QueryEscape(author) + "&after_seq=" + strconv.Itoa(afterSeq)
	attemptKey := id + "|" + author
	started := time.Now()
	raw, err := l.door(ctx, peer, "GET", path, nil)
	if err != nil {
		l.failCounts[attemptKey]++
		return 0, err
	}
	rtt := int(time.Since(started).Milliseconds())
	var slice struct {
		Entries        []talk.Entry   `json:"entries"`
		Epoch          int            `json:"epoch"`
		HasMore        bool           `json:"has_more"`
		HighWaterMarks map[string]int `json:"high_water_marks"`
	}
	if err := json.Unmarshal(raw, &slice); err != nil {
		return 0, fmt.Errorf("decode replica: %w", err)
	}
	if len(slice.Entries) == 0 {
		delete(l.failCounts, attemptKey)
		return 0, nil
	}
	transport := &talk.Transport{Rung: "L1", RTTMs: rtt}
	// Retries are real data: a pull that finally landed after injected (or
	// genuine) failures carries how many attempts it truly took.
	if failures := l.failCounts[attemptKey]; failures > 0 {
		transport.Attempts = failures + 1
	}
	delete(l.failCounts, attemptKey)
	result, err := l.store.MergeEntries(id, slice.Entries, slice.Epoch, transport)
	if err != nil {
		return 0, err
	}
	return result.Accepted, nil
}
