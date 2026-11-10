#!/bin/sh
# Install what `egress` needs: egress-proxy.mjs, which the Host starts when
# `egress` names it, and the static aeven-egress-relay each jail runs in front of
# its command, both into <image>/shim. The proxy runs as its own user, apart from
# the Host's and the jails', through /usr/local/libexec/aeven-egress-exec, so a
# command that escapes its jail cannot read the credentials the proxy carries.
# The socket directory belongs to that user's group with setgid; the Host's user
# joins the group to create each account's subdirectory there, and others may
# only traverse it. Also lets accounts install Python packages: pip joins the
# image, and aeven_user_site.py sends installs to the caller's ~/.local. Run as
# root on the Host after every change to these files, then restart the Host so
# its user joins the group; safe to rerun.
#
#   sudo sh install-egress.sh [image] [host user] [egress user] [socket dir]
#   (defaults: /opt/aeven-sandbox, aeven-hosted, aeven-egress, /var/lib/aeven-egress)
set -eu
IMAGE=${1:-/opt/aeven-sandbox}
HOST_USER=${2:-aeven-hosted}
EGRESS_USER=${3:-aeven-egress}
SOCKET_DIR=${4:-/var/lib/aeven-egress}
HERE=$(cd "$(dirname "$0")" && pwd)
EXEC=/usr/local/libexec/aeven-egress-exec

[ "$(id -u)" = 0 ] || { echo "install-egress: run as root" >&2; exit 1; }
command -v musl-gcc >/dev/null || DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq musl-tools >/dev/null
command -v cc >/dev/null && command -v setcap >/dev/null \
  || DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq gcc libcap2-bin >/dev/null

mkdir -p "$IMAGE/shim"
musl-gcc -static -O2 -Wall -o "$IMAGE/shim/aeven-egress-relay.new" "$HERE/egress-relay.c"
chmod 0755 "$IMAGE/shim/aeven-egress-relay.new"
mv -f "$IMAGE/shim/aeven-egress-relay.new" "$IMAGE/shim/aeven-egress-relay"
install -m 0644 "$HERE/egress-proxy.mjs" "$IMAGE/shim/egress-proxy.mjs"

# The proxy's user, and the helper only the Host's group may execute, holding only the capabilities that switch to it.
id "$EGRESS_USER" >/dev/null 2>&1 || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$EGRESS_USER"
usermod -aG "$EGRESS_USER" "$HOST_USER"
mkdir -p "$(dirname "$EXEC")"
cc -O2 -Wall -DSANDBOX_USER="\"$EGRESS_USER\"" -o "$EXEC.new" "$HERE/sandbox-exec.c"
chown root:"$(id -gn "$HOST_USER")" "$EXEC.new"
chmod 0750 "$EXEC.new"
setcap cap_setuid,cap_setgid=ep "$EXEC.new"
mv -f "$EXEC.new" "$EXEC"

# Account subdirectories inherit the group; the proxy writes sockets in them, and jails' users only traverse.
mkdir -p "$SOCKET_DIR"
find "$SOCKET_DIR" -mindepth 1 -delete
chown "$EGRESS_USER:$EGRESS_USER" "$SOCKET_DIR"
chmod 2771 "$SOCKET_DIR"

if [ -x "$IMAGE/bin/python3" ]; then
  "$IMAGE/bin/python3" -m pip --version >/dev/null 2>&1 || "$IMAGE/bin/python3" -m ensurepip >/dev/null
  # ensurepip installs pip3 only; commands and the model call `pip`.
  [ -e "$IMAGE/bin/pip" ] || ln -s pip3 "$IMAGE/bin/pip"
  SITE=$("$IMAGE/bin/python3" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')
  install -m 0644 "$HERE/aeven_user_site.py" "$SITE/aeven_user_site.py"
  echo 'import aeven_user_site' > "$SITE/aeven-user-site.pth"
  # The jail cannot write bytecode, so everything added here is compiled now.
  "$IMAGE/bin/python3" -m compileall -q "$SITE/pip" "$SITE/aeven_user_site.py" >/dev/null
fi
echo "install-egress: relay and proxy in $IMAGE/shim; set egress in the sandbox-jail config and restart the Host"
