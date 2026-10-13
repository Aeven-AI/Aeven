package store

import (
	"database/sql"

	"modernc.org/sqlite"
)

// The pure-Go SQLite driver registers under the "sqlite3" name that this
// package and whatsmeow's sqlstore open, so the binary cross-compiles with
// CGO_ENABLED=0. DSN options use the driver's `_pragma=name(value)` form.
func init() {
	sql.Register("sqlite3", &sqlite.Driver{})
}
