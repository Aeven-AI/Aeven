package client

import (
	"strings"
	"sync/atomic"

	waBinary "go.mau.fi/whatsmeow/binary"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// NodeObserver receives every node whatsmeow reads from the socket. whatsmeow
// has no hook for a notification it does not understand; its Recv sub-logger
// sees every node first, so an observer installed there can act on stages
// whatsmeow rejects, such as a phone-code `refresh_code`.
type NodeObserver struct {
	fn atomic.Pointer[func(*waBinary.Node)]
}

// Set installs fn, replacing any earlier one. fn runs on whatsmeow's receive
// loop, so it must return promptly and hand any work to a goroutine.
func (o *NodeObserver) Set(fn func(*waBinary.Node)) { o.fn.Store(&fn) }

func (o *NodeObserver) notify(node *waBinary.Node) {
	if fn := o.fn.Load(); fn != nil {
		(*fn)(node)
	}
}

// observingLogger passes every line to base and hands received nodes to the
// observer. whatsmeow logs each received node as `Debugf("%s", node)`.
type observingLogger struct {
	base     waLog.Logger
	mod      string
	observer *NodeObserver
}

// WithNodeObserver wraps a whatsmeow logger so every received node reaches the
// returned observer, whatever level base prints.
func WithNodeObserver(base waLog.Logger) (waLog.Logger, *NodeObserver) {
	observer := &NodeObserver{}
	return &observingLogger{base: base, observer: observer}, observer
}

func (l *observingLogger) Debugf(msg string, args ...interface{}) {
	if strings.HasSuffix(l.mod, "/Recv") && len(args) == 1 {
		if node, ok := args[0].(*waBinary.Node); ok && node != nil {
			l.observer.notify(node)
		}
	}
	l.base.Debugf(msg, args...)
}

func (l *observingLogger) Infof(msg string, args ...interface{})  { l.base.Infof(msg, args...) }
func (l *observingLogger) Warnf(msg string, args ...interface{})  { l.base.Warnf(msg, args...) }
func (l *observingLogger) Errorf(msg string, args ...interface{}) { l.base.Errorf(msg, args...) }

func (l *observingLogger) Sub(mod string) waLog.Logger {
	return &observingLogger{base: l.base.Sub(mod), mod: l.mod + "/" + mod, observer: l.observer}
}
