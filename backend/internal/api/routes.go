// Package api — HTTP route handlers and the RegisterRoutes wiring.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dongchankim-io/ssediff/backend/internal/stream"
)

// Stats is the JSON shape served by GET /api/stats per spec §3.5 §3.6.
type Stats struct {
	MatchCount      int64 `json:"matchCount"`
	MismatchCount   int64 `json:"mismatchCount"`
	OrphanCount     int64 `json:"orphanCount"`
	BufferedItems   int64 `json:"bufferedItems"`
	UptimeSeconds   int64 `json:"uptimeSeconds"`
	ActiveWsClients int64 `json:"activeWsClients"`
}

// HealthResponse is the JSON shape served by GET /api/health.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// RoutesConfig bundles the dependencies a fully-wired server needs.
type RoutesConfig struct {
	Hub       *Hub
	Sessions  *SessionController
	Version   string
	PublicDir string
	Logger    *slog.Logger
}

// RegisterRoutes attaches every route from spec §3.4 onto mux. Returns
// the mux unchanged for chaining.
func RegisterRoutes(mux *http.ServeMux, cfg RoutesConfig) *http.ServeMux {
	mux.HandleFunc("GET /api/health", healthHandler(cfg.Version))
	mux.HandleFunc("GET /api/stats", statsHandler(cfg.Hub))
	mux.HandleFunc("POST /api/session/start", startHandler(cfg.Sessions, cfg.Logger))
	mux.HandleFunc("POST /api/session/stop", stopHandler(cfg.Sessions))
	mux.HandleFunc("GET /ws", cfg.Hub.ServeWS)
	mux.Handle("GET /", staticHandler(cfg.PublicDir, cfg.Logger))
	return mux
}

// healthHandler returns a small JSON document including the build
// version, so operators can verify deployments without a separate
// /version endpoint.
func healthHandler(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, HealthResponse{Status: "ok", Version: version})
	}
}

// statsHandler exposes the matcher + hub counters.
func statsHandler(h *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		ms := h.matcher.Stats()
		writeJSON(w, http.StatusOK, Stats{
			MatchCount:      ms.MatchCount,
			MismatchCount:   ms.MismatchCount,
			OrphanCount:     ms.OrphanCount,
			BufferedItems:   ms.BufferedItems,
			UptimeSeconds:   h.UptimeSeconds(),
			ActiveWsClients: h.ActiveClients(),
		})
	}
}

// startHandler parses the request body (capped + disallow unknown fields)
// and hands off to SessionController.Start. Validation errors become
// 400; all other errors become 500.
func startHandler(s *SessionController, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		defer r.Body.Close()

		var req SessionRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			writeStartError(w, r, logger, err)
			return
		}

		if _, err := s.Start(r.Context(), req); err != nil {
			writeStartError(w, r, logger, err)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
	}
}

// stopHandler is idempotent — multiple calls produce the same 200.
func stopHandler(s *SessionController) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		s.Stop()
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
	}
}

// writeStartError maps the various ways /api/session/start can fail
// into the appropriate HTTP status code and error body. Every
// client-correctable failure (body too big, JSON parse, validation,
// SSRF, scheme, denied header) becomes a 4xx with a clear message;
// only true server-side failures become 500.
func writeStartError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, err error) {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		writeJSON(w, http.StatusRequestEntityTooLarge,
			map[string]string{"error": fmt.Sprintf("request body exceeds %d bytes", maxBodyBytes)})
		return
	}
	if ve, ok := IsValidationError(err); ok {
		writeJSON(w, http.StatusBadRequest, ve)
		return
	}
	if isJSONError(err) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if isClientStreamError(err) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	logger.Error("session start failed", "err", err, "remote", r.RemoteAddr)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
}

// isClientStreamError reports whether err comes from the stream package's
// upstream-validation layer (SSRF deny-list, bad scheme, userinfo,
// fragment, reserved header). These are configuration mistakes the
// operator made in the request, not server bugs — they belong in 400.
func isClientStreamError(err error) bool {
	return errors.Is(err, stream.ErrInvalidScheme) ||
		errors.Is(err, stream.ErrURLUserInfo) ||
		errors.Is(err, stream.ErrURLFragment) ||
		errors.Is(err, stream.ErrEmptyHost) ||
		errors.Is(err, stream.ErrPrivateTarget) ||
		errors.Is(err, stream.ErrReservedHeader)
}

// isJSONError reports whether err comes from the JSON decoder. We use
// type-assertion checks so we don't accidentally classify server-side
// validation failures as client mistakes.
func isJSONError(err error) bool {
	var (
		syntaxErr      *json.SyntaxError
		unmarshalErr   *json.UnmarshalTypeError
		invalidJSONErr *json.InvalidUnmarshalError
	)
	if errors.As(err, &syntaxErr) || errors.As(err, &unmarshalErr) || errors.As(err, &invalidJSONErr) {
		return true
	}
	// json.Decoder.DisallowUnknownFields produces a non-typed error
	// whose message starts with "json: unknown field".
	return strings.HasPrefix(err.Error(), "json:")
}

// staticHandler serves files from publicDir with an SPA fallback to
// index.html for any non-asset path that isn't a real file. Provides a
// helpful 200 if the directory hasn't been built yet (dev mode).
func staticHandler(publicDir string, logger *slog.Logger) http.Handler {
	indexPath := filepath.Join(publicDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		logger.Warn("public dir missing — serving placeholder",
			"public_dir", publicDir,
			"hint", "run `make build` to build the frontend first",
		)
		return placeholderHandler(publicDir)
	}
	fs := http.FileServer(http.Dir(publicDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		full := filepath.Join(publicDir, filepath.Clean(r.URL.Path))
		info, err := os.Stat(full)
		if err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		// Not a real file. If the path looks like an asset (has a dot
		// in the final segment), return a real 404 so missing JS / CSS
		// is loud. Otherwise serve index.html to support client-side
		// routing.
		if strings.Contains(filepath.Base(r.URL.Path), ".") {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	})
}

// placeholderHandler is the fallback for dev mode where the frontend
// hasn't been built. Emits a 200 with a helpful HTML page so first-
// time users see what they need to do.
func placeholderHandler(publicDir string) http.Handler {
	body := []byte(`<!doctype html><html><body style="font-family:system-ui;background:#020617;color:#f1f5f9;padding:2rem">
<h1>ssediff backend is running</h1>
<p>The frontend has not been built yet. Either:</p>
<ul>
  <li><code>cd frontend &amp;&amp; npm run dev</code> for live reload at <code>http://localhost:5173</code>, or</li>
  <li><code>cd frontend &amp;&amp; npm run build</code> to populate <code>` + publicDir + `</code> and then refresh this page.</li>
</ul>
</body></html>`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || !strings.Contains(filepath.Base(r.URL.Path), ".") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
			return
		}
		http.NotFound(w, r)
	})
}

// writeJSON is the single point all handlers funnel through, so the
// content type is set consistently and encoding errors are logged.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
