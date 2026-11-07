package store

import "database/sql"

// contactNameExpr coalesces the whatsmeow_contacts name columns in preference
// order: the saved address-book name first, then push name, first name, and
// business name. NULLIF folds empty strings into NULL so COALESCE skips them.
const contactNameExpr = `COALESCE(NULLIF(full_name,''), NULLIF(push_name,''), NULLIF(first_name,''), NULLIF(business_name,''))`

// ContactName returns the synced address-book name for a JID from the
// whatsmeow_contacts table, or "" when the contact is unknown or the
// whatsmeow store is unavailable. A LID JID is looked up under its phone JID
// first, then as itself, where whatsmeow keeps the push names of contacts it
// only knows by LID.
func (s *Store) ContactName(jid string) string {
	if s.whatsmeowDB == nil {
		return ""
	}
	for _, candidate := range []string{s.ResolveLIDToJID(jid), jid} {
		var name sql.NullString
		err := s.whatsmeowDB.QueryRow(
			`SELECT `+contactNameExpr+` FROM whatsmeow_contacts WHERE their_jid = ?`, candidate).Scan(&name)
		if err == nil && name.Valid && name.String != "" {
			return name.String
		}
	}
	return ""
}

// searchContactNames returns address-book contacts whose name or JID matches
// the LIKE pattern, as a jid -> display-name map. Empty when the whatsmeow
// store is unavailable.
func (s *Store) searchContactNames(pattern string) map[string]string {
	out := map[string]string{}
	if s.whatsmeowDB == nil {
		return out
	}
	rows, err := s.whatsmeowDB.Query(`
		SELECT their_jid, `+contactNameExpr+` AS name
		FROM whatsmeow_contacts
		WHERE their_jid LIKE '%@s.whatsapp.net'
		  AND (LOWER(full_name) LIKE LOWER(?) OR LOWER(push_name) LIKE LOWER(?)
		    OR LOWER(first_name) LIKE LOWER(?) OR LOWER(business_name) LIKE LOWER(?)
		    OR their_jid LIKE ?)
		LIMIT 50`, pattern, pattern, pattern, pattern, pattern)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var jid string
		var name sql.NullString
		if err := rows.Scan(&jid, &name); err != nil {
			continue
		}
		if name.Valid && name.String != "" {
			out[jid] = name.String
		}
	}
	return out
}
