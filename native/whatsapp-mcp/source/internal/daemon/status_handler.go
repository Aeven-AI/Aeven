package daemon

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
)

// accountReporter is implemented by drivers that can name the paired
// account. Production wiring satisfies it; test fakes need not.
type accountReporter interface {
	Account() (phone, name string)
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
