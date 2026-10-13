// Package daemon runs the long-lived whatsapp-mcp process: it owns the
// HTTP listener, mounts the MCP endpoint, serves the /pair UI, and drives
// the pairing state machine against a whatsmeow client.
package daemon

import (
	"sync"
)

// PairCache holds the latest QR code bytes emitted by whatsmeow's pairing
// channel and a flag indicating whether the device is currently paired.
// Safe for concurrent readers and a single writer (the pairing goroutine).
type PairCache struct {
	mu     sync.RWMutex
	qr     string
	paired bool
	// ended names the terminal whatsmeow QR-channel event ("timeout" or an
	// error event) when pairing stopped without success; "" otherwise.
	ended string
}

// NewPairCache returns an empty cache in the "unpaired, no QR yet" state.
func NewPairCache() *PairCache {
	return &PairCache{}
}

// SetQR stores the latest pairing code. Clears the paired flag.
func (c *PairCache) SetQR(code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.qr = code
	c.paired = false
	c.ended = ""
}

// SetPaired flips the paired flag on and clears any pending QR.
func (c *PairCache) SetPaired() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.qr = ""
	c.paired = true
	c.ended = ""
}

// Reset drops the paired flag and clears any pending QR. Used when a
// user-driven re-pair starts.
func (c *PairCache) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.qr = ""
	c.paired = false
	c.ended = ""
}

// SetEnded records that pairing stopped without success; event is the
// terminal QR-channel event name. Clears any pending QR.
func (c *PairCache) SetEnded(event string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.qr = ""
	c.paired = false
	c.ended = event
}

// Ended returns the terminal pairing event, or "" while pairing is live or
// the device is paired.
func (c *PairCache) Ended() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ended
}

// Paired reports whether the device is currently paired.
func (c *PairCache) Paired() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.paired
}

// QR returns the latest cached pairing code, or "" if none has been emitted
// since the last Reset or SetPaired.
func (c *PairCache) QR() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.qr
}
