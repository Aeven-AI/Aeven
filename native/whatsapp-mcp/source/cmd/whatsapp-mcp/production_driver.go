package main

import (
	"context"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/sealjay/mcp-whatsapp/internal/client"
)

// sessionCloseWait bounds how long a phone-code request waits for the
// replaced login session's QR channel to close before connecting anyway.
// whatsmeow closes the channel as soon as it sees the cancelled context, so
// this only matters when the replaced session never received a QR event.
const sessionCloseWait = 2 * time.Second

// productionDriver adapts *client.Client to the daemon.pairDriver interface.
// The Client owns all whatsmeow-facing state; the driver owns only the
// current login session, so a phone-code request can replace it.
type productionDriver struct {
	c *client.Client

	mu        sync.Mutex
	ctx       context.Context
	onQR      func(string)
	onSuccess func()
	onEnd     func(string)
	// session is the login websocket whose QR channel reports to the
	// callbacks; a replaced session's events are dropped.
	session *loginSession
}

// loginSession is one unpaired login websocket and its QR channel.
type loginSession struct {
	cancel context.CancelFunc
	// closed is closed once the QR channel has closed.
	closed chan struct{}
}

func newProductionDriver(c *client.Client) *productionDriver {
	return &productionDriver{c: c}
}

func (p *productionDriver) IsLoggedIn() bool { return p.c.IsLoggedIn() }

func (p *productionDriver) StartPairing(ctx context.Context, onQR func(string), onSuccess func(), onEnd func(string)) error {
	p.mu.Lock()
	p.ctx, p.onQR, p.onSuccess, p.onEnd = ctx, onQR, onSuccess, onEnd
	p.mu.Unlock()
	return p.openSession(nil)
}

// openSession opens a fresh login websocket and follows its QR channel.
// ready, when non-nil, is closed at the first QR code: whatsmeow accepts a
// phone-code request only from then on.
func (p *productionDriver) openSession(ready chan struct{}) error {
	p.mu.Lock()
	sessionCtx, cancel := context.WithCancel(p.ctx)
	session := &loginSession{cancel: cancel, closed: make(chan struct{})}
	p.session = session
	connectCtx := p.ctx
	p.mu.Unlock()

	qrCh, err := p.c.QRChannel(sessionCtx)
	if err != nil {
		cancel()
		close(session.closed)
		return err
	}
	go p.follow(session, qrCh, ready)
	// Must call Connect AFTER QRChannel per whatsmeow docs.
	return p.c.Connect(connectCtx, client.ConnectOpts{AllowUnpaired: true})
}

// follow relays one session's QR channel to the callbacks while that session
// is current. The channel closes after "success", "timeout", a pairing error,
// or a cancelled session context; passkey items are not terminal.
func (p *productionDriver) follow(session *loginSession, qrCh <-chan whatsmeow.QRChannelItem, ready chan struct{}) {
	defer close(session.closed)
	// A session that closes before its first code releases the waiting
	// phone-code request, whose PairPhone call then reports the failure.
	defer func() {
		if ready != nil {
			close(ready)
		}
	}()
	end := whatsmeow.QRChannelTimeout.Event
	for item := range qrCh {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			if ready != nil {
				close(ready)
				ready = nil
			}
			if onQR := p.callbacks(session).onQR; onQR != nil {
				onQR(item.Code)
			}
		case whatsmeow.QRChannelSuccess.Event:
			if onSuccess := p.callbacks(session).onSuccess; onSuccess != nil {
				onSuccess()
			}
			return
		case whatsmeow.QRChannelEventPasskeyRequest, whatsmeow.QRChannelEventPasskeyResponse:
			// Passkey linking needs a WebAuthn ceremony for WhatsApp's own
			// origin, which this device cannot perform; the QR and the phone
			// code stay valid beside it.
		default:
			end = item.Event
		}
	}
	if onEnd := p.callbacks(session).onEnd; onEnd != nil {
		onEnd(end)
	}
}

// sessionCallbacks are the pairing callbacks a session may still call.
type sessionCallbacks struct {
	onQR      func(string)
	onSuccess func()
	onEnd     func(string)
}

// callbacks answers the pairing callbacks when session is current, and none
// for a replaced session.
func (p *productionDriver) callbacks(session *loginSession) sessionCallbacks {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.session != session {
		return sessionCallbacks{}
	}
	return sessionCallbacks{onQR: p.onQR, onSuccess: p.onSuccess, onEnd: p.onEnd}
}

func (p *productionDriver) Connect(ctx context.Context, onLoggedOut func()) error {
	p.c.AddLoggedOutHandler(func(_ *events.LoggedOut) { onLoggedOut() })
	p.c.StartEventHandler()
	if p.c.IsConnected() {
		// The pairing flow already connected this client; just install
		// the post-pair handlers and return.
		return nil
	}
	return p.c.Connect(ctx, client.ConnectOpts{})
}

func (p *productionDriver) Logout(ctx context.Context) error { return p.c.Logout(ctx) }

// PairPhone replaces the login session with a fresh one and asks WhatsApp
// for a phone-number linking code on it. A code is valid only while its login
// websocket lives, and whatsmeow closes that websocket when the session's QR
// codes run out 160 seconds after connecting, so a code requested on a
// session the reader has already been looking at could expire before they
// type it. The fresh session also shows a new QR, which stays valid beside
// the code. The phone shows a notification that opens the code entry screen.
func (p *productionDriver) PairPhone(ctx context.Context, phone string) (string, error) {
	p.mu.Lock()
	previous := p.session
	p.session = nil
	p.mu.Unlock()
	if previous != nil {
		previous.cancel()
		select {
		case <-previous.closed:
		case <-time.After(sessionCloseWait):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	p.c.Disconnect()

	ready := make(chan struct{})
	if err := p.openSession(ready); err != nil {
		return "", err
	}
	select {
	case <-ready:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	return p.c.WA().PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
}

func (p *productionDriver) Disconnect() { p.c.Disconnect() }

func (p *productionDriver) Account() (phone, name string) {
	wa := p.c.WA()
	if wa == nil || wa.Store == nil || wa.Store.ID == nil {
		return "", ""
	}
	return wa.Store.ID.User, wa.Store.PushName
}
