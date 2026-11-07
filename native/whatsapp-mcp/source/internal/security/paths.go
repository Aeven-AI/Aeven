// Package security holds policy-layer helpers used across the MCP bridge:
// path allowlisting for outbound media, filename sanitisation for inbound
// documents, and a log redactor for JIDs and message bodies.
package security

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// ValidateMediaPath resolves userPath to an absolute, symlink-resolved path
// and returns it if it is equal to, or lives under, allowedRoot. Empty input
// returns "" with no error (the caller treats it as "no media"). Missing
// files and out-of-root paths both return wrapped errors naming the attempted
// path and root so an MCP client can surface them to the user.
func ValidateMediaPath(userPath, allowedRoot string) (string, error) {
	if userPath == "" {
		return "", nil
	}
	abs, err := filepath.Abs(userPath)
	if err != nil {
		return "", fmt.Errorf("invalid media_path %q: %w", userPath, err)
	}
	abs = filepath.Clean(abs)
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("media_path %q not accessible: %w", abs, err)
	}
	rootResolved, err := resolveRoot(allowedRoot)
	if err != nil {
		return "", err
	}
	if err := confine("media_path", resolved, rootResolved); err != nil {
		return "", err
	}
	return resolved, nil
}

// ValidateMediaPathIn is ValidateMediaPath over several allowed roots: the
// path is accepted under the first root that holds it. The error for a path
// no root holds names every root, so the caller can move the file into one.
func ValidateMediaPathIn(userPath string, allowedRoots []string) (string, error) {
	if len(allowedRoots) == 1 {
		return ValidateMediaPath(userPath, allowedRoots[0])
	}
	var firstErr error
	for _, root := range allowedRoots {
		resolved, err := ValidateMediaPath(userPath, root)
		if err == nil {
			return resolved, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		// A missing or unreadable file fails the same way under every root.
		if !strings.Contains(err.Error(), "is outside allowed root") {
			return "", err
		}
	}
	if firstErr == nil {
		return "", fmt.Errorf("no allowed media root is configured")
	}
	return "", fmt.Errorf("media_path %q is outside every allowed root (%s); place the file under one of them", userPath, strings.Join(allowedRoots, ", "))
}

// resolveRoot returns allowedRoot absolute, cleaned, and symlink-resolved.
// A root that does not exist yet falls back to its cleaned absolute form.
func resolveRoot(allowedRoot string) (string, error) {
	rootAbs, err := filepath.Abs(allowedRoot)
	if err != nil {
		return "", fmt.Errorf("invalid allowed root %q: %w", allowedRoot, err)
	}
	rootAbs = filepath.Clean(rootAbs)
	rootResolved, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return rootAbs, nil
	}
	return rootResolved, nil
}

// confine rejects resolved paths that are neither root itself nor under it;
// field names the offending parameter in the error.
func confine(field, resolved, root string) error {
	if resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator)) {
		return fmt.Errorf("%s %q is outside allowed root %q; set WHATSAPP_MCP_MEDIA_ROOT or place the file under that root", field, resolved, root)
	}
	return nil
}

// ValidateOutputPath is the sister of ValidateMediaPath for files that do
// not yet exist. The caller (download_media) is asking us to *create* a file
// at userPath; only the parent directory has to exist on disk. We resolve
// the parent via EvalSymlinks, then re-anchor the basename and confine the
// whole thing inside allowedRoot. Symlinked parents that point outside the
// root are rejected the same way ValidateMediaPath rejects symlinked files.
func ValidateOutputPath(userPath, allowedRoot string) (string, error) {
	if userPath == "" {
		return "", fmt.Errorf("output_path is required when provided")
	}
	abs, err := filepath.Abs(userPath)
	if err != nil {
		return "", fmt.Errorf("invalid output_path %q: %w", userPath, err)
	}
	abs = filepath.Clean(abs)
	parent := filepath.Dir(abs)
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", fmt.Errorf("output_path parent directory %q not accessible: %w", parent, err)
	}
	resolved := filepath.Join(resolvedParent, filepath.Base(abs))

	rootResolved, err := resolveRoot(allowedRoot)
	if err != nil {
		return "", err
	}
	if err := confine("output_path", resolved, rootResolved); err != nil {
		return "", err
	}
	return resolved, nil
}

// ValidateOutputPathIn is ValidateOutputPath over several allowed roots: the
// path is accepted under the first root that holds it.
func ValidateOutputPathIn(userPath string, allowedRoots []string) (string, error) {
	if len(allowedRoots) == 1 {
		return ValidateOutputPath(userPath, allowedRoots[0])
	}
	for _, root := range allowedRoots {
		resolved, err := ValidateOutputPath(userPath, root)
		if err == nil {
			return resolved, nil
		}
		if !strings.Contains(err.Error(), "is outside allowed root") {
			return "", err
		}
	}
	return "", fmt.Errorf("output_path %q is outside every allowed root (%s); choose a path under one of them", userPath, strings.Join(allowedRoots, ", "))
}

// SafeFilename returns filepath.Base(raw) unless the base is one of the
// degenerate values that could escape a join or hit special-case behaviour
// ("", ".", "..", "/", or contains a null byte), in which case it returns
// a timestamped fallback of the form "document_YYYYMMDD_HHMMSS". Matches
// the old whatsapp-bridge behaviour.
func SafeFilename(raw string) string {
	if strings.ContainsRune(raw, '\x00') {
		return fallbackFilename()
	}
	base := filepath.Base(raw)
	switch base {
	case "", ".", "..", "/":
		return fallbackFilename()
	}
	return base
}

func fallbackFilename() string {
	return "document_" + time.Now().UTC().Format("20060102_150405")
}
