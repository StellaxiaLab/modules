package main

import (
	"log"
	"net/http"
	"strings"
)

// principalHeader and subjectHeader are stamped by the Gateway on every call it
// forwards to a module (terra-sdk docs/contracts/module-host-http-contract.md
// section 7). The Gateway strips any client-sent X-Terra-* header first, so the
// values are the Gateway's assertion; the user's token never reaches the module.
const (
	principalHeader = "X-Terra-Principal"
	subjectHeader   = "X-Terra-Subject"
)

// unknownActor is recorded when the Gateway sent no principal. That is stated
// as such rather than guessed: an empty actor would read as "nobody".
const unknownActor = "unknown"

const maxActorLen = 200

// cleanHeader trims a caller header and drops control characters, so a value can
// never forge an extra line in the process log or in events.jsonl viewers.
func cleanHeader(v string) string {
	v = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, strings.TrimSpace(v))
	if len(v) > maxActorLen {
		v = strings.ToValidUTF8(v[:maxActorLen], "")
	}
	return v
}

// callerActor reads who asked from the Gateway-stamped headers. Only the
// identity is read; no credential or token is ever part of it.
func callerActor(r *http.Request) (actor, subject string) {
	actor = cleanHeader(r.Header.Get(principalHeader))
	if actor == "" {
		actor = unknownActor
	}
	subject = cleanHeader(r.Header.Get(subjectHeader))
	if subject == actor {
		subject = ""
	}
	return actor, subject
}

// recordAudit notes a successful write operation: one "audit" line in the
// workload's events.jsonl naming the operation and the actor, and one process
// log line. keepHistory is false for delete: the workload's directory is gone
// and appending would recreate it.
func (s *service) recordAudit(r *http.Request, id, op string, keepHistory bool) {
	actor, subject := callerActor(r)
	log.Printf("workload: audit op=%s id=%s actor=%q", op, id, actor)
	if !keepHistory {
		return
	}
	detail := map[string]any{"op": op, "actor": actor}
	if subject != "" {
		detail["subject"] = subject
	}
	s.st.appendEvent(id, "audit", detail)
}
