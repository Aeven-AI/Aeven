package client

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// pairingTags are the node tags of the linking handshake: QR refs, the
// phone-code stages, the passkey and handoff stages, and the final
// pair-success. A sent or received node carrying one of them as its own tag
// or a direct child's tag is a pairing node.
var pairingTags = map[string]bool{
	"pair-device":                true,
	"pair-success":               true,
	"pair-error":                 true,
	"link_code_companion_reg":    true,
	"passkey_prologue_request":   true,
	"passkey_prologue":           true,
	"crsc_continuation":          true,
	"companion_nonce":            true,
	"companion_reg_refresh":      true,
	"pair-device-rotate-qr":      true,
	"encrypted_pairing_request":  true,
	"companion_finish":           true,
	"link_code_pairing_ref":      true,
	"primary_hello":              true,
	"companion_hello":            true,
	"link_code_pairing_finished": true,
}

// unrelatedTags are the traffic of a linked account, never of the handshake.
var unrelatedTags = map[string]bool{
	"message": true, "receipt": true, "ack": true, "call": true, "presence": true, "chatstate": true,
}

// isPairingNode reports whether a logged node belongs to the linking
// handshake, without rendering it. Every iq, notification, and stream
// control node counts until the file holds traceLimit lines, because a new
// handshake stage arrives under tags not known in advance.
func isPairingNode(node *waBinary.Node) bool {
	if unrelatedTags[node.Tag] {
		return false
	}
	if pairingTags[node.Tag] || node.Tag != "" {
		return true
	}
	for _, child := range node.GetChildren() {
		if pairingTags[child.Tag] {
			return true
		}
	}
	return false
}

// pairingTrace appends pairing nodes to one file. Linking an account sends
// and receives a handful of these, so the file stays small; message traffic
// never matches.
type pairingTrace struct {
	mu    sync.Mutex
	lines int
}

// traceLimit bounds one daemon's trace: a handshake takes a few dozen nodes.
const traceLimit = 300

// write prints one node to stderr, where the Host keeps warning lines in its
// own log. The Host cuts each line at 500 characters, so a node is written in
// numbered parts.
func (t *pairingTrace) write(direction string, node *waBinary.Node) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.lines >= traceLimit {
		return
	}
	t.lines++
	line := fmt.Sprintf("%s %s %s", time.Now().UTC().Format(time.RFC3339Nano), direction, node.String())
	const part = 400
	for i, n := 0, (len(line)+part-1)/part; i < n; i++ {
		end := min((i+1)*part, len(line))
		fmt.Fprintf(os.Stderr, "[Client/Trace WARN] %d.%d/%d %s\n", t.lines, i+1, n, line[i*part:end])
	}
}

// tracingLogger passes every line to base and also records the pairing nodes
// whatsmeow's Recv and Send sub-loggers emit at debug level, whatever level
// base prints. whatsmeow logs each node as `Debugf("%s", node)`.
type tracingLogger struct {
	base  waLog.Logger
	mod   string
	trace *pairingTrace
}

// WithPairingTrace wraps a whatsmeow logger so the nodes of the linking
// handshake are written to stderr, which lets an operator see exactly what
// WhatsApp sent when a link fails. The trace names the account's phone number,
// so it is for diagnosis only and off unless the operator turns it on.
func WithPairingTrace(base waLog.Logger) waLog.Logger {
	return &tracingLogger{base: base, trace: &pairingTrace{}}
}

func (l *tracingLogger) Debugf(msg string, args ...interface{}) {
	if direction, ok := nodeDirection(l.mod); ok && len(args) == 1 {
		if node, isNode := args[0].(*waBinary.Node); isNode && node != nil && isPairingNode(node) {
			l.trace.write(direction, node)
		}
	}
	l.base.Debugf(msg, args...)
}

func (l *tracingLogger) Infof(msg string, args ...interface{})  { l.base.Infof(msg, args...) }
func (l *tracingLogger) Warnf(msg string, args ...interface{})  { l.base.Warnf(msg, args...) }
func (l *tracingLogger) Errorf(msg string, args ...interface{}) { l.base.Errorf(msg, args...) }

func (l *tracingLogger) Sub(mod string) waLog.Logger {
	return &tracingLogger{base: l.base.Sub(mod), mod: l.mod + "/" + mod, trace: l.trace}
}

// nodeDirection names the direction of whatsmeow's node-dump sub-loggers.
func nodeDirection(mod string) (string, bool) {
	switch {
	case strings.HasSuffix(mod, "/Recv"):
		return "<--", true
	case strings.HasSuffix(mod, "/Send"):
		return "-->", true
	default:
		return "", false
	}
}
