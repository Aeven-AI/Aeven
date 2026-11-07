package mcp

import (
	"context"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sealjay/mcp-whatsapp/internal/media"
)

// mediaConvertTimeout bounds the ffmpeg run that makes a voice note playable
// in a browser.
const mediaConvertTimeout = 60 * time.Second

// mediaContentTypes names the type a browser needs for each served media
// kind when the file's extension names none; a document without one is
// served as an unknown type.
var mediaContentTypes = map[string]string{
	"image":   "image/jpeg",
	"sticker": "image/webp",
	"video":   "video/mp4",
	"gif":     "video/mp4",
	"audio":   "audio/mp4",
}

// handleMedia serves the decrypted media of one cached message, so a client
// can show an image, play a video or GIF, or play a voice note. Query
// parameters: chat (chat JID) and id (message ID). A voice note is served
// re-encoded as AAC, cached beside the download. The route sits behind the
// daemon's bearer-token middleware like every other route.
func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	chat, id := r.URL.Query().Get("chat"), r.URL.Query().Get("id")
	if chat == "" || id == "" {
		http.Error(w, "chat and id are required", http.StatusBadRequest)
		return
	}
	result := s.client.Download(r.Context(), id, chat, "")
	if !result.Success {
		http.Error(w, result.Message, http.StatusNotFound)
		return
	}
	path := result.Path
	if result.MediaType == "audio" {
		playable := strings.TrimSuffix(path, filepath.Ext(path)) + ".m4a"
		if _, err := os.Stat(playable); err != nil {
			ctx, cancel := context.WithTimeout(r.Context(), mediaConvertTimeout)
			err = media.ConvertToM4A(ctx, path, playable)
			cancel()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
		}
		path = playable
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	contentType, known := mediaContentTypes[result.MediaType]
	if byExtension := mime.TypeByExtension(filepath.Ext(path)); result.MediaType != "audio" && byExtension != "" {
		contentType = byExtension
	} else if !known {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Media-Type", result.MediaType)
	http.ServeContent(w, r, "", info.ModTime(), file)
}
