#!/bin/sh
# Add motion rendering to the hosted sandbox image: a headless Chromium, GSAP,
# open-licensed fonts, and render-motion. Run as root on the Host; safe to rerun.
#
#   sudo sh install-motion.sh [image]        (image defaults to /opt/aeven-sandbox)
set -eu
IMAGE=${1:-/opt/aeven-sandbox}
HERE=$(cd "$(dirname "$0")" && pwd)
FONTS=/usr/local/share/fonts/aeven

[ "$(id -u)" = 0 ] || { echo "install-motion: run as root" >&2; exit 1; }
[ -d "$IMAGE/node" ] || { echo "install-motion: no Node image at $IMAGE/node" >&2; exit 1; }

# Fonts from Ubuntu: the Noto families cover every script, CJK, and colour emoji.
DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq --no-install-recommends fontconfig fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  fonts-dejavu-core fonts-liberation2 >/dev/null

# Display families from google/fonts, all under the SIL Open Font License; each
# folder keeps its OFL.txt.
for family in googlesansflex inter robotoflex montserrat poppins dmsans playfairdisplay jetbrainsmono \
  spacegrotesk outfit bebasneue oswald lora; do
  mkdir -p "$FONTS/$family"
  curl -fsSL "https://api.github.com/repos/google/fonts/contents/ofl/$family" | python3 -c '
import json, sys
for entry in json.load(sys.stdin):
    if entry["name"].endswith((".ttf", ".otf")) or entry["name"] == "OFL.txt":
        print(entry["name"] + "\t" + entry["download_url"])
' | while IFS="$(printf '\t')" read -r name url; do
    [ -s "$FONTS/$family/$name" ] || curl -fsSL -o "$FONTS/$family/$name" "$url"
  done
done
chmod -R a+rX "$FONTS"
fc-cache -f >/dev/null

# Chromium and GSAP, installed into the image's Node modules.
npm install --prefix "$IMAGE/node" --no-audit --no-fund playwright-core@1.64.1 gsap@3.15.0 >/dev/null
PLAYWRIGHT_BROWSERS_PATH="$IMAGE/ms-playwright" "$IMAGE/node/node_modules/.bin/playwright-core" install chromium-headless-shell >/dev/null
install -D -m 0644 "$HERE/render-motion.mjs" "$IMAGE/motion/render-motion.mjs"
printf '#!/bin/sh\nexec node %s/motion/render-motion.mjs "$@"\n' "$IMAGE" > "$IMAGE/bin/render-motion"
chmod 0755 "$IMAGE/bin/render-motion"
chmod -R a+rX "$IMAGE/node/node_modules" "$IMAGE/ms-playwright"

echo "install-motion: $(fc-list | wc -l) font faces; render-motion at $IMAGE/bin/render-motion"
