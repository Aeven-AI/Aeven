#!/bin/sh
# Install the Python zygote into <image>/shim: python-zygote.py, which the Host
# starts when `pythonZygote` names it, and a static `python3` (and `python`)
# shim that runs each invocation in it, or executes <image>/bin/python3 when it
# is not running. Put <image>/shim first on the jail's PATH. Run as root on the
# Host after every change to these files; safe to rerun.
#
#   sudo sh install-python-zygote.sh [image]   (image defaults to /opt/aeven-sandbox)
set -eu
IMAGE=${1:-/opt/aeven-sandbox}
HERE=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "install-python-zygote: run as root" >&2; exit 1; }
command -v musl-gcc >/dev/null || DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq musl-tools >/dev/null

[ -x "$IMAGE/bin/python3" ] || { echo "install-python-zygote: no interpreter at $IMAGE/bin/python3" >&2; exit 1; }
mkdir -p "$IMAGE/shim"
musl-gcc -static -O2 -Wall -DREAL_PYTHON="\"$IMAGE/bin/python3\"" -o "$IMAGE/shim/python3.new" "$HERE/python-shim.c"
chmod 0755 "$IMAGE/shim/python3.new"
mv -f "$IMAGE/shim/python3.new" "$IMAGE/shim/python3"
ln -sf python3 "$IMAGE/shim/python"
install -m 0644 "$HERE/python-zygote.py" "$IMAGE/shim/python-zygote.py"
