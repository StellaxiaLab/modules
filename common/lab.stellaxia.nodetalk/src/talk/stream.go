package talk

// The stream hub fans one conversation's events out to its local SSE
// subscribers. Local only by design: the remote hop cannot carry a stream
// (the Master relay waits for ONE correlated response — idea doc §11), so
// remote arrivals come in as replica.push calls (M2) and are re-published
// here for this node's own screens.

const subscriberBuffer = 32

type hub struct {
	nextID      int
	subscribers map[int]chan StreamEvent
}

// Subscribe registers a listener for one conversation's events. The returned
// cancel is idempotent and must be called; events after cancel are dropped.
func (s *Store) Subscribe(id string) (<-chan StreamEvent, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadMetaLocked(id); err != nil {
		return nil, nil, err
	}
	h := s.hubs[id]
	if h == nil {
		h = &hub{subscribers: map[int]chan StreamEvent{}}
		s.hubs[id] = h
	}
	h.nextID++
	subscriberID := h.nextID
	events := make(chan StreamEvent, subscriberBuffer)
	h.subscribers[subscriberID] = events

	cancel := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if current := s.hubs[id]; current != nil {
			if _, live := current.subscribers[subscriberID]; live {
				delete(current.subscribers, subscriberID)
				close(events)
			}
			if len(current.subscribers) == 0 {
				delete(s.hubs, id)
			}
		}
	}
	return events, cancel, nil
}

// publishLocked hands an event to every subscriber without ever blocking an
// append: a subscriber that stopped draining loses events rather than holding
// the writer — the transcript on disk stays the truth, the stream is only a
// nudge to re-render, and a bench screen that fell behind refreshes anyway.
func (s *Store) publishLocked(id string, event StreamEvent) {
	h := s.hubs[id]
	if h == nil {
		return
	}
	for _, subscriber := range h.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}
