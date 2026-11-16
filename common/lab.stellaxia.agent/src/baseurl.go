package main

// The one place that says where a registered API key may be sent.
//
// module.json declares `network: api.anthropic.com`. A base_url that points
// anywhere else would carry the key (and every prompt) to a host the manifest
// never named, so a registration may use only the vendor's own endpoint, or a
// loopback address — which is how a test server or a local proxy on this node
// is reached without leaving the machine.

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// allowedProviderHosts maps a provider to the hosts its base_url may name.
var allowedProviderHosts = map[string][]string{
	"anthropic": {"api.anthropic.com"},
}

// validateBaseURL returns nil for an empty value (the SDK default) or a URL
// that stays inside the manifest's network declaration.
func validateBaseURL(provider, raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("base_url %q is not an absolute URL", raw)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("base_url must not carry credentials, a query or a fragment")
	}
	host := strings.ToLower(parsed.Hostname())
	if isLoopbackHost(host) {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return fmt.Errorf("base_url scheme must be http or https")
		}
		return nil
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("base_url must use https unless it is a loopback address")
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return fmt.Errorf("base_url must use the default https port")
	}
	for _, allowed := range allowedProviderHosts[provider] {
		if host == allowed {
			return nil
		}
	}
	return fmt.Errorf("base_url host %q is outside this module's declared network (%s); only that host or a loopback address is allowed",
		host, strings.Join(allowedProviderHosts[provider], ", "))
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
