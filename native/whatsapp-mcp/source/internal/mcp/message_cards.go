package mcp

import (
	"context"
	"sort"
	"time"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/sealjay/mcp-whatsapp/internal/store"
)

// cardMessage is one message as a client draws it: who sent it, when, its
// text, and which media it carries. The bytes of that media are served by the
// daemon's /media route, keyed by ID and ChatJID.
type cardMessage struct {
	ID         string `json:"id"`
	ChatJID    string `json:"chat_jid"`
	ChatName   string `json:"chat_name,omitempty"`
	SenderName string `json:"sender_name"`
	IsFromMe   bool   `json:"is_from_me"`
	IsGroup    bool   `json:"is_group"`
	Timestamp  string `json:"timestamp"`
	Content    string `json:"content,omitempty"`
	MediaType  string `json:"media_type,omitempty"`
	Filename   string `json:"filename,omitempty"`
}

// messageCards is the structured content of list_messages and
// get_message_context. Focus names the message get_message_context was asked
// about; list_messages leaves it empty.
type messageCards struct {
	Messages []cardMessage `json:"messages"`
	Focus    string        `json:"focus,omitempty"`
}

// cardsOf resolves each message's sender name and orders the messages oldest
// first, once each: list_messages repeats a message that falls in the context
// of two matches, and lists its context windows newest first.
func (s *Server) cardsOf(ctx context.Context, msgs []store.Message, focus string) messageCards {
	seen := make(map[string]bool, len(msgs))
	unique := make([]store.Message, 0, len(msgs))
	for _, m := range msgs {
		key := m.ChatJID + "\x00" + m.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, m)
	}
	sort.SliceStable(unique, func(i, j int) bool { return unique[i].Timestamp.Before(unique[j].Timestamp) })
	cards := make([]cardMessage, 0, len(unique))
	for _, m := range unique {
		sender := "Me"
		if !m.IsFromMe {
			sender = s.client.Store().GetSenderName(ctx, m.Sender)
		}
		cards = append(cards, cardMessage{
			ID: m.ID, ChatJID: m.ChatJID, ChatName: m.ChatName, SenderName: sender,
			IsFromMe: m.IsFromMe, IsGroup: m.IsGroup, Timestamp: m.Timestamp.UTC().Format(time.RFC3339),
			Content: m.Content, MediaType: m.MediaType, Filename: m.Filename,
		})
	}
	return messageCards{Messages: cards, Focus: focus}
}

// withCards attaches the structured messages to a text result. The text block
// stays the model-visible answer; structured content is for clients that draw
// the messages.
func withCards(result *mcp.CallToolResult, cards messageCards) *mcp.CallToolResult {
	result.StructuredContent = cards
	return result
}
