package daemon

import "testing"

func TestInternationalDigits(t *testing.T) {
	cases := []struct {
		typed string
		want  string
		ok    bool
	}{
		{"+31 6 12345678", "31612345678", true},
		{"0031612345678", "31612345678", true},
		{"31612345678", "31612345678", true},
		{"0612345678", "", false},
		{"+31 (0)6 12345678", "31612345678", true},
		{"12345", "", false},
	}
	for _, c := range cases {
		got, ok := internationalDigits(c.typed)
		if got != c.want || ok != c.ok {
			t.Errorf("internationalDigits(%q) = %q, %v; want %q, %v", c.typed, got, ok, c.want, c.ok)
		}
	}
}
