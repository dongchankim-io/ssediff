// Package api wires HTTP and WebSocket routes for ssediff.
//
// validate.go holds request-shape and size validation for
// /api/session/start (spec §3.6 limits + header hygiene). Pure
// functions; no I/O, no goroutines.
package api

import (
	"errors"
	"fmt"
	"strings"

	"github.com/dongchankim-io/ssediff/backend/internal/stream"
)

// Request limits per spec §3.6 "Security — request limits".
const (
	maxBodyBytes        = 64 << 10 // POST /api/session/start
	maxURLBytes         = 2 << 10
	maxHeadersPerStream = 32
	maxHeaderValueBytes = 8 << 10
)

// SessionStream is the per-side configuration in a session-start request.
type SessionStream struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

// SessionRequest is the parsed body of POST /api/session/start per spec
// §3.5. JSON tags use camelCase to match the wire format.
type SessionRequest struct {
	StreamA         SessionStream `json:"streamA"`
	StreamB         SessionStream `json:"streamB"`
	CorrelationPath string        `json:"correlationPath"`
}

// ValidationError is the structured error type the HTTP layer turns into
// a 400 response body. Carries the field name that failed and a human-
// readable reason, suitable for inline display in the UI's ConfigBar.
type ValidationError struct {
	Field   string `json:"field,omitempty"`
	Message string `json:"error"`
}

func (e *ValidationError) Error() string { return e.Message }

// invalid builds a ValidationError with a fmt-formatted message.
func invalid(field, format string, args ...any) error {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// ValidateSessionRequest checks the request body against every spec §3.6
// limit (URL ≤ 2 KiB, ≤ 32 headers per stream, value ≤ 8 KiB, no \r\n in
// values) and applies the stream package's URL + header-name validators.
// Returns the first failure as a *ValidationError.
func ValidateSessionRequest(req *SessionRequest) error {
	if req == nil {
		return invalid("", "request body is empty")
	}
	if strings.TrimSpace(req.CorrelationPath) == "" {
		return invalid("correlationPath", "correlationPath is required")
	}
	if err := validateStream("streamA", req.StreamA); err != nil {
		return err
	}
	if err := validateStream("streamB", req.StreamB); err != nil {
		return err
	}
	return nil
}

// validateStream runs the shape and size guards on one side of the
// request. Returns at the first failure for fast feedback.
func validateStream(side string, s SessionStream) error {
	if len(s.URL) == 0 {
		return invalid(side+".url", "url is required")
	}
	if len(s.URL) > maxURLBytes {
		return invalid(side+".url", "url exceeds %d bytes", maxURLBytes)
	}
	if _, err := stream.ValidateURL(s.URL); err != nil {
		return invalid(side+".url", "%s", err.Error())
	}
	if len(s.Headers) > maxHeadersPerStream {
		return invalid(side+".headers", "more than %d headers (got %d)", maxHeadersPerStream, len(s.Headers))
	}
	for name, value := range s.Headers {
		if err := stream.ValidateHeaderName(name); err != nil {
			return invalid(side+".headers."+name, "%s", err.Error())
		}
		if len(value) > maxHeaderValueBytes {
			return invalid(side+".headers."+name, "header value exceeds %d bytes", maxHeaderValueBytes)
		}
		if strings.ContainsAny(value, "\r\n") {
			return invalid(side+".headers."+name, "header value must not contain newlines")
		}
	}
	return nil
}

// IsValidationError unwraps the error chain looking for ValidationError.
func IsValidationError(err error) (*ValidationError, bool) {
	var ve *ValidationError
	if errors.As(err, &ve) {
		return ve, true
	}
	return nil, false
}
