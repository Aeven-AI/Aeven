package security

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateMediaPathIn(t *testing.T) {
	media := t.TempDir()
	work := t.TempDir()
	other := t.TempDir()
	inWork := filepath.Join(work, "heart.png")
	inOther := filepath.Join(other, "secret.png")
	for _, f := range []string{inWork, inOther} {
		if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := ValidateMediaPathIn(inWork, []string{media, work}); err != nil || !strings.HasSuffix(got, "heart.png") {
		t.Fatalf("file under a send root: got %q, %v", got, err)
	}
	if _, err := ValidateMediaPathIn(inOther, []string{media, work}); err == nil || !strings.Contains(err.Error(), "outside every allowed root") {
		t.Fatalf("file outside every root: got %v", err)
	}
	if _, err := ValidateMediaPathIn(filepath.Join(work, "missing.png"), []string{media, work}); err == nil || !strings.Contains(err.Error(), "not accessible") {
		t.Fatalf("missing file: got %v", err)
	}
}
