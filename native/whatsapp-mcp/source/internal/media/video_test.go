package media

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestConvertGIFToMP4(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	gif := filepath.Join(t.TempDir(), "heart.gif")
	// A two-frame, odd-sized GIF: the conversion must round it to even dimensions.
	gen := exec.Command("ffmpeg", "-f", "lavfi", "-i", "color=c=red:s=33x31:d=0.2:r=10", "-y", gif)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("making the test GIF: %v: %s", err, out)
	}
	mp4, err := ConvertGIFToMP4(context.Background(), gif)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(mp4)
	data, err := os.ReadFile(mp4)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 12 || !bytes.Equal(data[4:8], []byte("ftyp")) {
		t.Fatalf("output is not an MP4 (%d bytes)", len(data))
	}
}

func TestVideoStillJPEG(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	gif := filepath.Join(dir, "loop.gif")
	gen := exec.Command("ffmpeg", "-f", "lavfi", "-i", "color=c=red:s=64x48:d=0.3:r=10", "-y", gif)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Fatalf("making the test GIF: %v: %s", err, out)
	}
	mp4, err := ConvertGIFToMP4(context.Background(), gif)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(mp4)
	still, err := VideoStillJPEG(context.Background(), mp4)
	if err != nil {
		t.Fatal(err)
	}
	if len(still) < 3 || still[0] != 0xFF || still[1] != 0xD8 {
		t.Fatalf("still frame is not a JPEG (%d bytes)", len(still))
	}
}
