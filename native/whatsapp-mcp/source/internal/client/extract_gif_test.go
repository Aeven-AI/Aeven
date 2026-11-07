package client

import (
	"testing"

	"google.golang.org/protobuf/proto"

	waProto "go.mau.fi/whatsmeow/binary/proto"
)

func TestExtractMediaInfo_GIFAndSticker(t *testing.T) {
	gif := &waProto.Message{VideoMessage: &waProto.VideoMessage{GifPlayback: proto.Bool(true), FileSHA256: []byte{1, 2}}}
	if kind, name, _, _, _, _, _, _ := extractMediaInfo(gif); kind != "gif" || name == "" {
		t.Fatalf("looping video: got %q %q, want gif", kind, name)
	}
	clip := &waProto.Message{VideoMessage: &waProto.VideoMessage{FileSHA256: []byte{1, 2}}}
	if kind, _, _, _, _, _, _, _ := extractMediaInfo(clip); kind != "video" {
		t.Fatalf("plain video: got %q, want video", kind)
	}
	sticker := &waProto.Message{StickerMessage: &waProto.StickerMessage{FileSHA256: []byte{3}}}
	if kind, name, _, _, _, _, _, _ := extractMediaInfo(sticker); kind != "sticker" || len(name) < 5 || name[len(name)-5:] != ".webp" {
		t.Fatalf("sticker: got %q %q, want sticker .webp", kind, name)
	}
}
