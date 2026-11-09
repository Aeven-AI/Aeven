#!/bin/sh
# Install what `egress` needs into <image>/shim: egress-proxy.mjs, which the
# Host starts when `egress` names it, and the static aeven-egress-relay each
# jail runs in front of its command. Also creates the proxy's socket directory
# for the sandbox user, and lets accounts install Python packages: pip joins the
# image, and aeven_user_site.py sends installs to the caller's ~/.local. Run as
# root on the Host after every change to these files; safe to rerun.
#
#   sudo sh install-egress.sh [image] [sandbox user] [socket dir]
#   (defaults: /opt/aeven-sandbox, aeven-sandbox, /var/lib/aeven-egress)
set -eu
IMAGE=${1:-/opt/aeven-sandbox}
SANDBOX_USER=${2:-aeven-sandbox}
SOCKET_DIR=${3:-/var/lib/aeven-egress}
HERE=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "install-egress: run as root" >&2; exit 1; }
command -v musl-gcc >/dev/null || DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq musl-tools >/dev/null

mkdir -p "$IMAGE/shim"
musl-gcc -static -O2 -Wall -o "$IMAGE/shim/aeven-egress-relay.new" "$HERE/egress-relay.c"
chmod 0755 "$IMAGE/shim/aeven-egress-relay.new"
mv -f "$IMAGE/shim/aeven-egress-relay.new" "$IMAGE/shim/aeven-egress-relay"
install -m 0644 "$HERE/egress-proxy.mjs" "$IMAGE/shim/egress-proxy.mjs"

# The proxy runs as the sandbox user when the Host has one, and its socket lives outside the Host's data directory.
if id "$SANDBOX_USER" >/dev/null 2>&1; then
  install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" -m 0700 "$SOCKET_DIR"
fi

if [ -x "$IMAGE/bin/python3" ]; then
  "$IMAGE/bin/python3" -m pip --version >/dev/null 2>&1 || "$IMAGE/bin/python3" -m ensurepip >/dev/null
  SITE=$("$IMAGE/bin/python3" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')
  install -m 0644 "$HERE/aeven_user_site.py" "$SITE/aeven_user_site.py"
  echo 'import aeven_user_site' > "$SITE/aeven-user-site.pth"
  # The jail cannot write bytecode, so everything added here is compiled now.
  "$IMAGE/bin/python3" -m compileall -q "$SITE/pip" "$SITE/aeven_user_site.py" >/dev/null
fi
echo "install-egress: relay and proxy in $IMAGE/shim; set egress in the sandbox-jail config and restart the Host"
