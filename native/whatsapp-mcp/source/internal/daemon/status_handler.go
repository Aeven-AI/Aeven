package daemon

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// accountReporter is implemented by drivers that can name the paired
// account. Production wiring satisfies it; test fakes need not.
type accountReporter interface {
	Account() (phone, name string)
}

// phonePairer is implemented by drivers that can link by phone number:
// WhatsApp on that phone asks for the returned eight-character code instead
// of scanning a QR, which is the only way to link from the phone's own
// browser. Production wiring satisfies it; test fakes need not.
type phonePairer interface {
	PairPhone(ctx context.Context, phone string) (string, error)
}

// statusResponse is the machine-readable pairing state served at /status for
// supervisors that render the linking QR in their own UI.
//
// State is one of:
//   - "starting": unpaired, no pairing code emitted yet
//   - "qr": unpaired; QRPNG holds the current code as a base64 PNG
//   - "paired": a device session is stored; Phone/Name name the account
//   - "expired": the QR codes timed out without a scan
//   - "failed": pairing stopped on another terminal event (Event)
type statusResponse struct {
	State string `json:"state"`
	QRPNG string `json:"qr_png,omitempty"`
	Phone string `json:"phone,omitempty"`
	Name  string `json:"name,omitempty"`
	Event string `json:"event,omitempty"`
}

type statusHandlers struct {
	cache  *PairCache
	driver pairDriver
}

func (h *statusHandlers) mount(mux *http.ServeMux) {
	mux.HandleFunc("/status", h.handleStatus)
	mux.HandleFunc("/logout", h.handleLogout)
	mux.HandleFunc("/pair/phone", h.handlePairPhone)
}

// handlePairPhone requests a phone-number linking code for the pairing in
// progress. Body: {"phone":"<international number>"}; answers {"code":"..."}.
// The driver opens a fresh login session for the code, so a pairing whose QR
// expired can still link by phone; the new session's QR stays valid beside the
// code, and whichever the phone completes pairs the device. 409 means the
// device is already paired.
func (h *statusHandlers) handlePairPhone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	phone, ok := internationalDigits(req.Phone)
	if !ok {
		http.Error(w, "phone must be an international number of 7 to 15 digits, with its country code", http.StatusBadRequest)
		return
	}
	if h.cache.Paired() {
		http.Error(w, "already paired", http.StatusConflict)
		return
	}
	pairer, ok := h.driver.(phonePairer)
	if !ok {
		http.Error(w, "phone pairing unsupported", http.StatusNotImplemented)
		return
	}
	code, err := pairer.PairPhone(r.Context(), phone)
	if err != nil {
		// The supervisor discards this process's stderr, so the reason travels
		// in the response for the Host to log.
		http.Error(w, "phone pairing failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(struct {
		Code string `json:"code"`
	}{Code: code})
}

func (h *statusHandlers) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	var resp statusResponse
	switch ended := h.cache.Ended(); {
	case h.cache.Paired():
		resp.State = "paired"
		if reporter, ok := h.driver.(accountReporter); ok {
			resp.Phone, resp.Name = reporter.Account()
		}
	case ended == "timeout":
		resp.State = "expired"
	case ended != "":
		resp.State = "failed"
		resp.Event = ended
	case h.cache.QR() != "":
		png, err := renderQRPNG(h.cache.QR(), qrPNGSize)
		if err != nil {
			http.Error(w, "qr render failed", http.StatusInternalServerError)
			return
		}
		resp.State = "qr"
		resp.QRPNG = base64.StdEncoding.EncodeToString(png)
	default:
		resp.State = "starting"
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(resp)
}

// handleLogout removes this linked device from the WhatsApp account and
// clears the local session. The supervisor stops the process afterwards.
func (h *statusHandlers) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if h.driver.IsLoggedIn() {
		if err := h.driver.Logout(r.Context()); err != nil {
			http.Error(w, "logout failed", http.StatusBadGateway)
			return
		}
	}
	h.cache.Reset()
	w.WriteHeader(http.StatusNoContent)
}

// internationalDigits reduces a typed phone number to the digits WhatsApp
// expects: country code first, no "+" and no "00" international call prefix.
// A number starting with a single 0 is a national number whose country code
// is unknown, so it is refused rather than sent to WhatsApp, which would
// refuse it without saying why. A "(0)" written after the country code, as in
// "+31 (0)6 …", is the national trunk prefix and is dropped.
func internationalDigits(typed string) (string, bool) {
	var digits strings.Builder
	for _, ch := range strings.ReplaceAll(typed, "(0)", "") {
		if ch >= '0' && ch <= '9' {
			digits.WriteRune(ch)
		}
	}
	phone := strings.TrimPrefix(digits.String(), "00")
	if strings.HasPrefix(phone, "0") || len(phone) < 7 || len(phone) > 15 {
		return "", false
	}
	return phone, true
}
