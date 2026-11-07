package client

import (
	"testing"

	"google.golang.org/protobuf/proto"

	waProto "go.mau.fi/whatsmeow/binary/proto"
)

func TestMarkForwarded(t *testing.T) {
	text := &waProto.Message{ExtendedTextMessage: &waProto.ExtendedTextMessage{Text: proto.String("hi")}}
	markForwarded(text)
	if !text.GetExtendedTextMessage().GetContextInfo().GetIsForwarded() {
		t.Fatal("forwarded text carries no forwarded flag")
	}
	photo := &waProto.Message{ImageMessage: &waProto.ImageMessage{}}
	markForwarded(photo)
	if !photo.GetImageMessage().GetContextInfo().GetIsForwarded() || photo.GetImageMessage().GetContextInfo().GetForwardingScore() != 1 {
		t.Fatal("forwarded image carries no forwarded flag")
	}
}
