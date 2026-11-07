package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestGetMessageBody(t *testing.T) {
	s := openTestStore(t)
	ctx := context.Background()
	chat := "31600000000@s.whatsapp.net"
	if err := s.StoreChat(chat, "Test", time.Now()); err != nil {
		t.Fatal(err)
	}
	text := Message{ID: "T1", ChatJID: chat, Sender: "31600000000", Content: "see you at 8", Timestamp: time.Now()}
	photo := Message{ID: "P1", ChatJID: chat, Sender: "31600000000", Timestamp: time.Now(), MediaType: "image", Filename: "image.jpg"}
	for _, m := range []Message{text, photo} {
		if err := s.StoreMessage(ctx, m, nil, nil, nil, 0); err != nil {
			t.Fatal(err)
		}
	}
	if content, mediaType, err := s.GetMessageBody("T1", chat); err != nil || content != "see you at 8" || mediaType != "" {
		t.Fatalf("text message: got %q %q %v", content, mediaType, err)
	}
	if content, mediaType, err := s.GetMessageBody("P1", chat); err != nil || content != "" || mediaType != "image" {
		t.Fatalf("media message: got %q %q %v", content, mediaType, err)
	}
	if _, _, err := s.GetMessageBody("missing", chat); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing message: got %v, want sql.ErrNoRows", err)
	}
}
