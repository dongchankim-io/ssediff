package api_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/dongchankim-io/ssediff/backend/internal/api"
)

func TestStaticAssetsServed(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>ok</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	assets := filepath.Join(dir, "assets")
	if err := os.Mkdir(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, api.RoutesConfig{PublicDir: dir, Version: "test"})

	cases := []struct {
		path string
		code int
	}{
		{"/", http.StatusOK},
		{"/assets/app.js", http.StatusOK},
		{"/missing.js", http.StatusNotFound},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != tc.code {
			t.Errorf("GET %s: got status %d, want %d", tc.path, rec.Code, tc.code)
		}
	}
}
