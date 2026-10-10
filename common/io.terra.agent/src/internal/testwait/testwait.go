// Package testwait is the one place this module's tests say "wait until this
// is true".
//
// It is a deliberately small copy of the Until helper from Terra's
// terra-testwait: same default budget (5s), same poll interval (10ms), same
// TERRA_TEST_WAIT_SCALE knob that multiplies the budget on a loaded runner.
// The module has to build without a Terra checkout, and terra-testwait is a
// Terra-internal test package. Only Until is carried over — it is all this
// module calls.
package testwait

import (
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"
)

const (
	defaultBudget = 5 * time.Second
	pollInterval  = 10 * time.Millisecond
	scaleEnvVar   = "TERRA_TEST_WAIT_SCALE"
)

func scale() float64 {
	raw, present := os.LookupEnv(scaleEnvVar)
	if !present || raw == "" {
		return 1
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil || parsed <= 0 {
		panic(fmt.Sprintf("%s=%q is not a positive number", scaleEnvVar, raw))
	}
	return parsed
}

// Until polls cond until it is true and fails the test when the budget runs
// out. The poll interval does not scale; only the budget does.
func Until(t *testing.T, what string, cond func() bool) {
	t.Helper()
	budget := time.Duration(float64(defaultBudget) * scale())
	deadline := time.Now().Add(budget)
	for {
		if cond() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out after %s waiting for %s (budget %s × scale %g)", budget, what, defaultBudget, scale())
		}
		time.Sleep(pollInterval)
	}
}
