package client

import (
	"math"
	"testing"
)

func TestValidCoordinates(t *testing.T) {
	cases := []struct {
		lat, lon float64
		ok       bool
	}{
		{52.3676, 4.9041, true},
		{-33.8688, 151.2093, true},
		{90, 180, true},
		{0, 0, false},
		{91, 4, false},
		{52, -181, false},
		{math.NaN(), 4, false},
	}
	for _, c := range cases {
		if err := validCoordinates(c.lat, c.lon); (err == nil) != c.ok {
			t.Errorf("validCoordinates(%v, %v) = %v, want ok=%v", c.lat, c.lon, err, c.ok)
		}
	}
}
