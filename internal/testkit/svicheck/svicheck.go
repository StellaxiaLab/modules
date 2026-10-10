// Package svicheck holds the one shape check a module's SVI tests make on the
// resources it publishes.
//
// Terra's svi package has a full ValidateResource that the daemon runs on
// ingestion; it is host-side and not part of terra-sdk. A module's test only
// needs the part that is about what the module OWNS: that the descriptor it
// publishes is complete. This checks completeness (required fields present,
// at least one endpoint, endpoints well-formed and unique), not the host's
// enumeration rules. The daemon's validator remains the authority at runtime.
package svicheck

import (
	"fmt"
	"strings"

	svi "github.com/StellaxiaLab/terra-sdk/svi"
)

func blank(value string) bool { return strings.TrimSpace(value) == "" }

// Resource reports why a resource descriptor is incomplete, or nil.
func Resource(resource svi.ResourceDescriptor) error {
	if blank(resource.ResourceID) || blank(resource.NodeID) || blank(resource.CanonicalName) || blank(resource.ProviderID) {
		return fmt.Errorf("resource_id, node_id, canonical_name, and provider_id are required")
	}
	if blank(resource.Kind) {
		return fmt.Errorf("kind is required")
	}
	if blank(string(resource.Owner.Type)) || blank(resource.Owner.ID) {
		return fmt.Errorf("owner type and id are required")
	}
	if blank(string(resource.Status)) {
		return fmt.Errorf("status is required")
	}
	if resource.ExpiresAt.IsZero() {
		return fmt.Errorf("expires_at is required")
	}
	if len(resource.Endpoints) == 0 {
		return fmt.Errorf("at least one endpoint is required")
	}
	seen := map[string]bool{}
	for index, endpoint := range resource.Endpoints {
		if err := Endpoint(endpoint); err != nil {
			return fmt.Errorf("endpoint[%d]: %w", index, err)
		}
		if seen[endpoint.EndpointID] {
			return fmt.Errorf("duplicate endpoint_id %q", endpoint.EndpointID)
		}
		seen[endpoint.EndpointID] = true
	}
	return nil
}

// Endpoint reports why an endpoint descriptor is incomplete, or nil.
func Endpoint(endpoint svi.EndpointDescriptor) error {
	if blank(endpoint.EndpointID) {
		return fmt.Errorf("endpoint_id is required")
	}
	if blank(string(endpoint.Direction)) || blank(string(endpoint.Interaction)) || blank(string(endpoint.Status)) {
		return fmt.Errorf("direction, interaction, and status are required")
	}
	if len(endpoint.Operations) == 0 {
		return fmt.Errorf("at least one operation is required")
	}
	ops := map[svi.Operation]bool{}
	for _, operation := range endpoint.Operations {
		if ops[operation] {
			return fmt.Errorf("duplicate operation %q", operation)
		}
		ops[operation] = true
	}
	if endpoint.MaxConsumers < 0 {
		return fmt.Errorf("max_consumers cannot be negative")
	}
	return nil
}
