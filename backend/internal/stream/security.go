// Package stream — security primitives.
//
// This file holds the SSRF / header / URL validation logic the SSE
// client uses at session start (spec §3.6). The functions here are pure
// (no state, no I/O besides one bounded DNS lookup), goroutine-safe, and
// have one reason to change (security policy).
//
// Network I/O (HTTP, TLS) lives in client.go; the lifecycle / parser is
// in parser.go (slice 003 also adds that file).
package stream

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// dnsLookupTimeout bounds the one-time hostname resolution done at session
// start. SSE streams are long-lived; we don't want a wedged resolver to
// stall the session-start handler indefinitely.
const dnsLookupTimeout = 5 * time.Second

// deniedHeaderExact is the case-insensitive set of header names the spec
// forbids upstream-bound (§3.6 "header allow/deny").
var deniedHeaderExact = map[string]struct{}{
	"host":              {},
	"content-length":    {},
	"transfer-encoding": {},
	"connection":        {},
	"upgrade":           {},
}

// deniedHeaderPrefixes are matched case-insensitively as prefixes. The
// spec calls out `Proxy-*` explicitly.
var deniedHeaderPrefixes = []string{"proxy-"}

// blockedIPv4Nets covers private/loopback/link-local ranges that Go's
// built-in net.IP classifier methods do not fully cover. Currently:
//   - 0.0.0.0/8 — net.IP.IsUnspecified only matches 0.0.0.0, not the /8.
//
// All other deny-listed ranges (10/8, 172.16/12, 192.168/16, 169.254/16,
// 127/8, ::1/128, fc00::/7, fe80::/10) are caught by IsLoopback /
// IsLinkLocalUnicast / IsPrivate.
var blockedIPv4Nets = []*net.IPNet{
	mustCIDR("0.0.0.0/8"),
}

// Errors returned by Validate*/ResolveAndPin. Wrapped with %w so callers
// can errors.Is them to map to specific HTTP 400 messages.
var (
	// ErrInvalidScheme is returned when the URL scheme isn't http/https.
	ErrInvalidScheme = errors.New("stream: url scheme must be http or https")
	// ErrURLUserInfo is returned when the URL contains user:pass@host.
	ErrURLUserInfo = errors.New("stream: url userinfo (user:pass@) is not allowed")
	// ErrURLFragment is returned when the URL contains a #fragment.
	ErrURLFragment = errors.New("stream: url fragment is not allowed")
	// ErrEmptyHost is returned when the URL has no host component.
	ErrEmptyHost = errors.New("stream: url host is empty")
	// ErrPrivateTarget is returned when the resolved target IP is in the
	// private/loopback/link-local deny-list and ALLOW_PRIVATE_TARGETS is
	// false.
	ErrPrivateTarget = errors.New("stream: target IP is in the private deny-list (set ALLOW_PRIVATE_TARGETS=true to bypass for local dev)")
	// ErrReservedHeader is returned when a user-supplied header name is
	// on the spec §3.6 deny-list.
	ErrReservedHeader = errors.New("stream: header name is reserved")
)

// ValidateURL checks the URL shape per spec §3.6 (scheme, no userinfo,
// no fragment, non-empty host) and returns the parsed form. DNS
// resolution is deliberately not done here so callers can fail loudly
// on shape errors without paying for a DNS round trip.
func ValidateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("stream: parse url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w (got %q)", ErrInvalidScheme, u.Scheme)
	}
	if u.User != nil {
		return nil, ErrURLUserInfo
	}
	if u.Fragment != "" {
		return nil, ErrURLFragment
	}
	if u.Host == "" {
		return nil, ErrEmptyHost
	}
	return u, nil
}

// ValidateHeaderName returns nil iff name is not in the deny-list. The
// check is case-insensitive per spec.
func ValidateHeaderName(name string) error {
	lower := strings.ToLower(strings.TrimSpace(name))
	if _, denied := deniedHeaderExact[lower]; denied {
		return fmt.Errorf("%w: %q", ErrReservedHeader, name)
	}
	for _, prefix := range deniedHeaderPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return fmt.Errorf("%w: %q matches prefix %q*", ErrReservedHeader, name, prefix)
		}
	}
	return nil
}

// ResolveAndPin resolves hostname to a single allowed IP and returns it
// alongside the canonical host:port pair. Resolving once at session
// start is what prevents DNS-rebinding from changing the target between
// validation and actual dial (spec §3.6).
//
// If allowPrivate is true, private/loopback/link-local IPs are kept;
// only when allowPrivate is false do we reject them.
func ResolveAndPin(ctx context.Context, u *url.URL, allowPrivate bool) (net.IP, string, error) {
	host := u.Hostname()
	port := portFor(u)

	if ip := net.ParseIP(host); ip != nil {
		if !allowPrivate && isBlockedIP(ip) {
			return nil, "", fmt.Errorf("%w: %s", ErrPrivateTarget, ip)
		}
		return ip, port, nil
	}

	lookupCtx, cancel := context.WithTimeout(ctx, dnsLookupTimeout)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(lookupCtx, "ip", host)
	if err != nil {
		return nil, "", fmt.Errorf("stream: resolve %q: %w", host, err)
	}
	for _, ip := range ips {
		if !allowPrivate && isBlockedIP(ip) {
			continue
		}
		return ip, port, nil
	}
	if allowPrivate && len(ips) > 0 {
		return ips[0], port, nil
	}
	return nil, "", fmt.Errorf("%w: no allowed IP for %q (resolved %d candidates, all in deny-list)", ErrPrivateTarget, host, len(ips))
}

// portFor returns the explicit port from the URL, defaulting to 80/443
// based on scheme. Stored separately because the dialer needs it after
// we discard the URL's host and substitute the pinned IP.
func portFor(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	if u.Scheme == "https" {
		return "443"
	}
	return "80"
}

// isBlockedIP returns true if ip falls in any range we refuse to dial
// when allowPrivate is false.
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsPrivate() ||
		ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		for _, n := range blockedIPv4Nets {
			if n.Contains(v4) {
				return true
			}
		}
	}
	return false
}

// mustCIDR is a panic-on-error constructor used only at package init for
// the static deny-list above.
func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic("stream: invalid built-in CIDR " + s + ": " + err.Error())
	}
	return n
}
