package client

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"

	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// SendPoll sends a poll message. options are presented in the order given.
// selectableCount is clamped to 1 when <= 0.
func (c *Client) SendPoll(ctx context.Context, recipient, question string, options []string, selectableCount int) SendResult {
	if len(options) < 2 {
		return SendResult{Success: false, Message: "poll needs at least 2 options"}
	}
	if !c.wa.IsConnected() {
		return SendResult{Success: false, Message: "Not connected to WhatsApp"}
	}
	if selectableCount <= 0 {
		selectableCount = 1
	}

	recipientJID, err := parseRecipient(recipient)
	if err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}

	// BuildPollCreation generates the 32-byte MessageSecret and wires it onto
	// MessageContextInfo so that votes on the poll can be decrypted later.
	msg := c.wa.BuildPollCreation(question, options, selectableCount)

	resp, err := c.wa.SendMessage(ctx, recipientJID, msg)
	if err != nil {
		return SendResult{Success: false, Message: fmt.Sprintf("Error sending poll: %v", err)}
	}

	c.persistSent(ctx, recipientJID, resp.ID, question, "", msg)

	// Cache option names locally so incoming vote SHA-256 hashes can be reversed.
	if err := c.store.StorePollMetadata(ctx, resp.ID, recipientJID.String(), options); err != nil {
		c.log.Warnf("Failed to store poll metadata for %s: %v", resp.ID, err)
	}

	return SendResult{
		Success: true,
		Message: fmt.Sprintf("Poll sent to %s", recipient),
		ID:      resp.ID,
	}
}

// SendPollVote casts a vote on a previously-seen poll. pollMessageID is the
// original poll's message ID. options must exactly match the option names
// on the poll creation message.
func (c *Client) SendPollVote(ctx context.Context, chatJID, pollMessageID string, options []string) SendResult {
	if !c.wa.IsConnected() {
		return SendResult{Success: false, Message: "Not connected to WhatsApp"}
	}
	if pollMessageID == "" {
		return SendResult{Success: false, Message: "poll_message_id is required"}
	}
	if len(options) == 0 {
		return SendResult{Success: false, Message: "options must not be empty"}
	}

	chat, err := parseRecipient(chatJID)
	if err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}

	// Look up the original sender so we can rebuild the MessageInfo BuildPollVote needs.
	creator, err := c.store.GetPollCreator(ctx, pollMessageID, chat.String())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SendResult{Success: false, Message: "poll not found in cache — wait for message sync"}
		}
		return SendResult{Success: false, Message: fmt.Sprintf("Error looking up poll: %v", err)}
	}
	sender, err := resolvePollSenderJID(creator, chat)
	if err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}

	msgInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     chat,
			Sender:   sender,
			IsFromMe: false,
			IsGroup:  chat.Server == types.GroupServer,
		},
		ID: pollMessageID,
	}

	voteMsg, err := c.wa.BuildPollVote(ctx, msgInfo, options)
	if err != nil {
		return SendResult{Success: false, Message: fmt.Sprintf("Error building poll vote: %v", err)}
	}

	resp, err := c.wa.SendMessage(ctx, chat, voteMsg)
	if err != nil {
		return SendResult{Success: false, Message: fmt.Sprintf("Error sending poll vote: %v", err)}
	}

	return SendResult{
		Success: true,
		Message: fmt.Sprintf("Poll vote sent to %s", chatJID),
		ID:      resp.ID,
	}
}

// PollResults is the shape returned by GetPollResults.
type PollResults struct {
	PollMessageID string         `json:"poll_message_id"`
	ChatJID       string         `json:"chat_jid"`
	Tally         map[string]int `json:"tally"` // option name -> vote count
}

// GetPollResults returns the tally of votes on a poll we have metadata for.
// Returns sql.ErrNoRows wrapped if the poll is not in the local cache yet.
// Does not require an active connection — reads strictly from the local cache.
func (c *Client) GetPollResults(ctx context.Context, chatJID, pollMessageID string) (*PollResults, error) {
	if chatJID == "" {
		return nil, errors.New("chat_jid is required")
	}
	if pollMessageID == "" {
		return nil, errors.New("poll_message_id is required")
	}
	if c.store == nil {
		return nil, errors.New("poll store not initialised")
	}
	opts, results, err := c.store.GetPollResults(ctx, pollMessageID, chatJID)
	if err != nil {
		return nil, err
	}
	tally := make(map[string]int, len(opts))
	for _, o := range opts {
		tally[o] = 0
	}
	for _, r := range results {
		tally[r.Option] = r.Votes
	}
	return &PollResults{
		PollMessageID: pollMessageID,
		ChatJID:       chatJID,
		Tally:         tally,
	}, nil
}

// resolvePollSenderJID reconstructs the original sender JID of a poll from the
// `sender` column we persisted at message-ingest time. For direct chats the
// sender column holds the bare phone (user part). For groups it may be either
// a bare phone or a full JID (e.g. LID form). We normalise both to a JID.
func resolvePollSenderJID(sender string, chat types.JID) (types.JID, error) {
	if sender == "" {
		return types.JID{}, errors.New("poll creator JID not known — wait for message sync")
	}
	if strings.Contains(sender, "@") {
		jid, err := types.ParseJID(sender)
		if err != nil {
			return types.JID{}, fmt.Errorf("parse poll sender JID: %w", err)
		}
		return jid, nil
	}
	// Bare user part: construct a default-server JID unless the chat itself is
	// a direct chat with a different server (e.g. lid-only).
	server := types.DefaultUserServer
	if chat.Server != types.GroupServer && chat.Server != "" {
		server = chat.Server
	}
	return types.JID{User: sender, Server: server}, nil
}

// SendContactCard sends a contact vCard. If vcardOverride is non-empty, it is
// sent verbatim; otherwise buildVCard(name, phone) synthesises a vCard 3.0.
func (c *Client) SendContactCard(ctx context.Context, recipient, name, phone, vcardOverride string) SendResult {
	if !c.wa.IsConnected() {
		return SendResult{Success: false, Message: "Not connected to WhatsApp"}
	}
	if name == "" && phone == "" && vcardOverride == "" {
		return SendResult{Success: false, Message: errors.New("contact requires name, phone, or vcard").Error()}
	}

	recipientJID, err := parseRecipient(recipient)
	if err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}

	vcard := vcardOverride
	if vcard == "" {
		vcard = buildVCard(name, phone)
	}

	displayName := name
	if displayName == "" {
		displayName = phone
	}

	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String(displayName),
			Vcard:       proto.String(vcard),
		},
	}

	resp, err := c.wa.SendMessage(ctx, recipientJID, msg)
	if err != nil {
		return SendResult{Success: false, Message: fmt.Sprintf("Error sending contact card: %v", err)}
	}

	c.persistSent(ctx, recipientJID, resp.ID, displayName+" (contact card)", "", msg)

	return SendResult{
		Success: true,
		Message: fmt.Sprintf("Contact card sent to %s", recipient),
		ID:      resp.ID,
	}
}

// SendLocation sends a location pin: recipients see a map card at the given
// coordinates, labelled with name and address when supplied. It is a fixed
// point, like WhatsApp's "Send your current location"; a live share needs the
// sender to keep reporting the position, which this daemon does not do.
func (c *Client) SendLocation(ctx context.Context, recipient string, latitude, longitude float64, name, address string) SendResult {
	if !c.wa.IsConnected() {
		return SendResult{Success: false, Message: "Not connected to WhatsApp"}
	}
	if err := validCoordinates(latitude, longitude); err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}
	recipientJID, err := parseRecipient(recipient)
	if err != nil {
		return SendResult{Success: false, Message: err.Error()}
	}
	location := &waE2E.LocationMessage{
		DegreesLatitude:  proto.Float64(latitude),
		DegreesLongitude: proto.Float64(longitude),
	}
	if name != "" {
		location.Name = proto.String(name)
	}
	if address != "" {
		location.Address = proto.String(address)
	}
	msg := &waE2E.Message{LocationMessage: location}
	resp, err := c.wa.SendMessage(ctx, recipientJID, msg)
	if err != nil {
		return SendResult{Success: false, Message: fmt.Sprintf("Error sending location: %v", err)}
	}
	label := name
	if label == "" {
		label = fmt.Sprintf("%.5f, %.5f", latitude, longitude)
	}
	c.persistSent(ctx, recipientJID, resp.ID, label+" (location)", "", msg)
	return SendResult{
		Success: true,
		Message: fmt.Sprintf("Location sent to %s", recipient),
		ID:      resp.ID,
	}
}

// validCoordinates rejects a latitude or longitude outside the globe, and
// the 0,0 point a missing value would otherwise send.
func validCoordinates(latitude, longitude float64) error {
	if math.IsNaN(latitude) || math.IsNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
		return errors.New("latitude must be within -90..90 and longitude within -180..180")
	}
	if latitude == 0 && longitude == 0 {
		return errors.New("latitude and longitude are both 0; pass the real coordinates")
	}
	return nil
}
