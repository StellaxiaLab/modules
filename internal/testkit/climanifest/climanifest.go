// Package climanifest reads the CLI commands a module declares in its
// module.json, for that module's own tests.
//
// It decodes `contributions.cli.commands` as plain JSON. It is NOT the host's
// validator: the host (Terra's module runtime) rejects declarations by rules this
// package does not reproduce, and that authority stays with `terra module pack`
// in CI. What this package gives a test is the declaration as written — names,
// operations, pointers, session roles — so the test can check it against the
// module's own contract.
//
// Problems reports the few mistakes that are visible without the host: a
// command with no name or no operation, a repeated name, a session that also
// names a top-level operation. It exists so a test that used to assert "the
// platform dropped nothing" still fails on an obviously broken declaration.
package climanifest

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// Command kinds.
const (
	KindSession = "session"
	KindCommand = "command"
)

// Session roles' input modes.
const (
	InputCommand = "command"
	InputNone    = "none"
)

// FlagSourceStdin makes a flag read its value from standard input.
const FlagSourceStdin = "stdin"

var namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*( [a-z0-9][a-z0-9-]*)*$`)

// Arg is one positional argument.
type Arg struct {
	Name     string `json:"name"`
	Pointer  string `json:"pointer"`
	Type     string `json:"type,omitempty"`
	Required bool   `json:"required,omitempty"`
	Variadic bool   `json:"variadic,omitempty"`
	Ref      string `json:"ref,omitempty"`
}

// Flag is one named option.
type Flag struct {
	Name       string `json:"name"`
	Pointer    string `json:"pointer"`
	Type       string `json:"type,omitempty"`
	Required   bool   `json:"required,omitempty"`
	Source     string `json:"source,omitempty"`
	Ref        string `json:"ref,omitempty"`
	Deprecated string `json:"deprecated,omitempty"`
}

// ReadsStdin reports whether the flag takes its value from standard input.
func (f Flag) ReadsStdin() bool { return f.Source == FlagSourceStdin }

// SessionValue reads one scalar out of one operation's output.
type SessionValue struct {
	OperationID string `json:"operationId"`
	Pointer     string `json:"pointer"`
	Input       string `json:"input,omitempty"`
}

// SessionHistory reads what was already said.
type SessionHistory struct {
	OperationID  string `json:"operationId"`
	ItemsPointer string `json:"itemsPointer"`
	Input        string `json:"input,omitempty"`
}

// SessionStream follows what is being said.
type SessionStream struct {
	OperationID string `json:"operationId"`
	ItemPointer string `json:"itemPointer"`
	KindPointer string `json:"kindPointer,omitempty"`
	Input       string `json:"input,omitempty"`
}

// SessionSend writes one line.
type SessionSend struct {
	OperationID string `json:"operationId"`
	TextPointer string `json:"textPointer"`
	Input       string `json:"input,omitempty"`
}

// SessionItem says where the parts of one item live.
type SessionItem struct {
	AuthorPointer      string `json:"authorPointer"`
	AuthorLabelPointer string `json:"authorLabelPointer,omitempty"`
	TextPointer        string `json:"textPointer"`
	TimePointer        string `json:"timePointer,omitempty"`
	NotePointer        string `json:"notePointer,omitempty"`
	KindPointer        string `json:"kindPointer,omitempty"`
	SeqPointer         string `json:"seqPointer,omitempty"`
	SubjectPointer     string `json:"subjectPointer,omitempty"`
}

// Session is what a kind=session command is rendered from.
type Session struct {
	Identity *SessionValue     `json:"identity,omitempty"`
	Title    *SessionValue     `json:"title,omitempty"`
	History  SessionHistory    `json:"history"`
	Stream   SessionStream     `json:"stream"`
	Send     SessionSend       `json:"send"`
	Item     SessionItem       `json:"item"`
	Labels   map[string]string `json:"labels,omitempty"`
}

// Label is what to call one kind, falling back to the kind itself.
func (s Session) Label(kind string) string {
	if label, named := s.Labels[kind]; named && label != "" {
		return label
	}
	return kind
}

// OperationIDs lists every operation a session reaches.
func (s Session) OperationIDs() []string {
	ids := []string{}
	if s.Identity != nil {
		ids = append(ids, s.Identity.OperationID)
	}
	if s.Title != nil {
		ids = append(ids, s.Title.OperationID)
	}
	return append(ids, s.History.OperationID, s.Stream.OperationID, s.Send.OperationID)
}

// Command is one contributed subcommand, as declared.
type Command struct {
	Name        string   `json:"name"`
	OperationID string   `json:"operationId"`
	Summary     string   `json:"summary,omitempty"`
	Args        []Arg    `json:"args,omitempty"`
	Flags       []Flag   `json:"flags,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	Session     *Session `json:"session,omitempty"`
}

// IsSession reports whether this command opens a session.
func (c Command) IsSession() bool { return c.Kind == KindSession }

// DecodePointerToken resolves the RFC 6901 ~1 and ~0 escapes, in that order.
func DecodePointerToken(token string) string {
	return strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
}

type manifestFile struct {
	Contributions struct {
		CLI struct {
			Commands []json.RawMessage `json:"commands"`
		} `json:"cli"`
	} `json:"contributions"`
}

// Load reads the commands declared in the module.json at path. An entry that is
// not decodable is reported in problems rather than returned.
func Load(path string) (commands []Command, problems []string, err error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	var manifest manifestFile
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, nil, fmt.Errorf("decode %s: %w", path, err)
	}
	seen := map[string]bool{}
	for index, item := range manifest.Contributions.CLI.Commands {
		var command Command
		if err := json.Unmarshal(item, &command); err != nil {
			problems = append(problems, fmt.Sprintf("commands[%d]: %v", index, err))
			continue
		}
		command.Name = strings.TrimSpace(command.Name)
		if !namePattern.MatchString(command.Name) {
			problems = append(problems, fmt.Sprintf("commands[%d]: invalid name %q: expected lower-case words", index, command.Name))
			continue
		}
		switch command.Kind {
		case "", KindCommand:
			command.Kind = ""
			if command.OperationID == "" {
				problems = append(problems, fmt.Sprintf("commands[%d]: command %q has no operationId", index, command.Name))
				continue
			}
			if command.Session != nil {
				problems = append(problems, fmt.Sprintf("commands[%d]: command %q declares a session but is not kind %q", index, command.Name, KindSession))
				continue
			}
		case KindSession:
			if command.OperationID != "" {
				problems = append(problems, fmt.Sprintf("commands[%d]: session %q must not declare a top-level operationId", index, command.Name))
				continue
			}
			if command.Session == nil {
				problems = append(problems, fmt.Sprintf("commands[%d]: session %q has no session", index, command.Name))
				continue
			}
		default:
			problems = append(problems, fmt.Sprintf("commands[%d]: command %q has an unknown kind %q", index, command.Name, command.Kind))
			continue
		}
		if seen[command.Name] {
			problems = append(problems, fmt.Sprintf("commands[%d]: name %q is declared twice", index, command.Name))
			continue
		}
		seen[command.Name] = true
		commands = append(commands, command)
	}
	return commands, problems, nil
}
