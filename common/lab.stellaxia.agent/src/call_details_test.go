package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	agentcore "github.com/StellaxiaLab/terra-agent"
)

// 호출 줄의 입력 요약·결과 요약·output.mode(M-5). 값은 코어의 agentcore.Record가
// 만든다 — 가림(I1)도 코어에서 한 번 한다. 이 모듈은 받은 것을 옮기기만 하고,
// 코어가 아직 그 칸을 모르면(옛 버전) 칸을 비운다. 그래서 코어를 JSON으로 읽는다.

// withDetails is a Record as a core that knows the new fields would send it.
type withDetails struct {
	agentcore.Record
	InputSummary  string `json:"inputSummary,omitempty"`
	ResultSummary string `json:"resultSummary,omitempty"`
	OutputMode    string `json:"outputMode,omitempty"`
}

func TestDetailsOfReadsTheCoresFieldsByName(t *testing.T) {
	got := detailsOf(withDetails{
		Record:        agentcore.Record{Tool: agentcore.ToolInvoke},
		InputSummary:  `{"module_id":"x","api_key":"***"}`,
		ResultSummary: `{"state":"running"}`,
		OutputMode:    "accepted-job",
	})
	want := recordDetails{InputSummary: `{"module_id":"x","api_key":"***"}`, ResultSummary: `{"state":"running"}`, OutputMode: "accepted-job"}
	if got != want {
		t.Errorf("details = %+v", got)
	}
}

// 코어가 새 칸을 모르면(Record에 그 칸이 없으면) 비어 있고, 오류가 아니다.
func TestDetailsOfIsEmptyForACoreWithoutTheFields(t *testing.T) {
	if got := detailsOf(agentcore.Record{Tool: agentcore.ToolInvoke, Status: "ok"}); got != (recordDetails{}) {
		t.Errorf("details = %+v", got)
	}
}

func TestEntryCarriesDetailsOnCallPlannedAndExternalLines(t *testing.T) {
	details := recordDetails{InputSummary: `{"a":1}`, ResultSummary: `{"ok":true}`, OutputMode: "immediate"}
	for _, tc := range []struct {
		name   string
		record agentcore.Record
		kind   string
	}{
		{"call", agentcore.Record{Tool: agentcore.ToolInvoke, OperationID: opStatus, Status: agentcore.StatusOK}, kindCall},
		{"planned", agentcore.Record{Tool: agentcore.ToolInvoke, OperationID: opRestart, Status: agentcore.StatusPlanned}, kindPlanned},
		{"external", agentcore.Record{Tool: "ext__docs__lookup", External: true, Status: agentcore.StatusOK}, kindExternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			line := entryFromRecord(tc.record, details)
			if line.Kind != tc.kind {
				t.Fatalf("kind = %q", line.Kind)
			}
			if line.InputSummary != details.InputSummary || line.ResultSummary != details.ResultSummary || line.OutputMode != details.OutputMode {
				t.Errorf("entry = %+v", line)
			}
		})
	}
}

// 옛 core와 새 core 모두에서 같은 모양이다: 칸이 비면 JSON에서 빠진다.
func TestEntryDetailsAreAbsentFromJSONWhenEmpty(t *testing.T) {
	encoded, _ := json.Marshal(entryFromRecord(agentcore.Record{Tool: agentcore.ToolInvoke, OperationID: opStatus, Status: "ok"}, recordDetails{}))
	for _, key := range []string{"input_summary", "result_summary", "output_mode"} {
		if strings.Contains(string(encoded), key) {
			t.Errorf("empty %s must be absent: %s", key, encoded)
		}
	}
	filled, _ := json.Marshal(entryFromRecord(agentcore.Record{Tool: agentcore.ToolInvoke, Status: "ok"}, recordDetails{InputSummary: "{}", ResultSummary: "{}", OutputMode: "accepted-job"}))
	for _, want := range []string{`"input_summary":"{}"`, `"result_summary":"{}"`, `"output_mode":"accepted-job"`} {
		if !strings.Contains(string(filled), want) {
			t.Errorf("wire form lacks %s: %s", want, filled)
		}
	}
}

// 새 칸이 없는 옛 jsonl 기록도 그대로 읽힌다.
func TestOlderRecordsWithoutDetailsStillLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.jsonl")
	record := `{"meta":{"session_id":"old","state":"done","autonomy":"plan","simulate":false,"owner":"alice","steps":1,"max_steps":4,"created_ms":1,"updated_ms":2,"usage":{}}}` + "\n" +
		`{"entry":{"seq":1,"kind":"call","author":"agent","author_label":"agent","time_ms":2,"subject":"x","decision":"run","status":"ok","reason":"r"}}` + "\n"
	if err := os.WriteFile(path, []byte(record), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := readSessionRecord(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	lines := loaded.entriesAfter(0, 0)
	if len(lines) != 1 || lines[0].InputSummary != "" || lines[0].ResultSummary != "" || lines[0].OutputMode != "" || lines[0].Reason != "r" {
		t.Fatalf("entries = %+v", lines)
	}
}

// 새 칸이 있는 기록은 디스크에 썼다 읽어도 그대로다.
func TestDetailsSurviveTheRecordOnDisk(t *testing.T) {
	line := entryFromRecord(agentcore.Record{Tool: agentcore.ToolInvoke, OperationID: opRestart, Status: "ok"},
		recordDetails{InputSummary: `{"module_id":"x"}`, ResultSummary: `{"task_id":"t"}`, OutputMode: "accepted-job"})
	encoded, err := json.Marshal(map[string]any{"entry": line})
	if err != nil {
		t.Fatal(err)
	}
	var back struct{ Entry entry }
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatal(err)
	}
	if back.Entry.InputSummary != line.InputSummary || back.Entry.OutputMode != "accepted-job" {
		t.Errorf("round trip = %+v", back.Entry)
	}
}

// 코어가 새 칸을 갖게 되면(Record에 InputSummary가 있으면) 실제 호출이 칸을 채우고
// 비밀이 없다. 아직 옛 코어이면 이 시험은 건너뛴다 — 코어를 올리면 저절로 켜진다.
func TestARealCallFillsTheDetailsWhenTheCoreSupportsThem(t *testing.T) {
	if _, ok := reflect.TypeOf(agentcore.Record{}).FieldByName("InputSummary"); !ok {
		t.Skip("terra-agent core in go.mod predates Record.InputSummary (M-5)")
	}
	b := newBench(t,
		always(toolResponse("", invokeCall("c1", opStatus, `{"api_key":"sk-live-1234567890","name":"n"}`, "상태"))),
		always(textResponse("ok")),
	)
	current := b.runPrompt(t, "auto", false, "상태 봐줘")
	calls := entriesOfKind(current, kindCall)
	if len(calls) != 1 {
		t.Fatalf("calls = %+v", calls)
	}
	call := calls[0]
	if !strings.Contains(call.InputSummary, `"name":"n"`) || strings.Contains(call.InputSummary, "sk-live-1234567890") {
		t.Errorf("input summary = %q", call.InputSummary)
	}
	if call.OutputMode == "" {
		t.Errorf("output mode empty: %+v", call)
	}
	encoded, _ := json.Marshal(call)
	for _, secret := range []string{testCredential, testAPIKey, "sk-live-1234567890"} {
		if strings.Contains(string(encoded), secret) {
			t.Errorf("call entry carries a secret: %s", encoded)
		}
	}
}
