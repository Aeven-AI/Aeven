#!/bin/sh
# Prepare the Host for `commandUser`: a sandbox user that confined commands and
# the Python zygote run as, apart from the Host's user. Run as root; safe to
# rerun. Restart the Host afterwards, so it joins the sandbox user's group.
#
#   sudo sh install-sandbox-user.sh <accounts root> [host user] [sandbox user] [zygote socket dir] [accounts path]
#
# The Host's user keeps sole access to its data directory. The sandbox user
# reaches account folders only through a second mount of the accounts root at
# <accounts path>, whose top it may traverse but not list, and ACLs give both
# users access to every account folder, including entries either one creates later.
set -eu
ACCOUNTS=${1:?usage: install-sandbox-user.sh <accounts root> [host user] [sandbox user] [zygote socket dir] [accounts path]}
HOST_USER=${2:-aeven-hosted}
SANDBOX_USER=${3:-aeven-sandbox}
ZYGOTE_DIR=${4:-/var/lib/aeven-zygote}
ACCOUNTS_PATH=${5:-/srv/aeven-accounts}
HERE=$(cd "$(dirname "$0")" && pwd)
EXEC=/usr/local/libexec/aeven-sandbox-exec

[ "$(id -u)" = 0 ] || { echo "install-sandbox-user: run as root" >&2; exit 1; }
[ -d "$ACCOUNTS" ] || { echo "install-sandbox-user: no accounts root at $ACCOUNTS" >&2; exit 1; }
command -v setfacl >/dev/null && command -v cc >/dev/null && command -v setcap >/dev/null \
  || DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq acl gcc libcap2-bin >/dev/null

id "$SANDBOX_USER" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SANDBOX_USER"
usermod -aG "$SANDBOX_USER" "$HOST_USER"

# The helper: executable by the Host's group only, holding nothing but the two capabilities it needs.
mkdir -p "$(dirname "$EXEC")"
cc -O2 -Wall -DSANDBOX_USER="\"$SANDBOX_USER\"" -o "$EXEC.new" "$HERE/sandbox-exec.c"
chown root:"$(id -gn "$HOST_USER")" "$EXEC.new"
chmod 0750 "$EXEC.new"
setcap cap_setuid,cap_setgid=ep "$EXEC.new"
mv -f "$EXEC.new" "$EXEC"

# Both users read and write every account folder; new entries inherit the same grant. The sandbox user may pass
# through the accounts root to a folder whose name it knows, but not list it.
setfacl -m u:"$SANDBOX_USER":--x,d:u:"$SANDBOX_USER":rwx,d:u:"$HOST_USER":rwx,d:m::rwx "$ACCOUNTS"
for account in "$ACCOUNTS"/*/; do
  [ -d "$account" ] || continue
  case "$account" in */lost+found/) continue ;; esac
  setfacl -R -m u:"$SANDBOX_USER":rwX,u:"$HOST_USER":rwX,m::rwX "$account"
  find "$account" -xdev -type d -exec setfacl -m d:u:"$SANDBOX_USER":rwx,d:u:"$HOST_USER":rwx,d:m::rwx {} +
done

# The zygote's socket lives outside the Host's data directory, which the sandbox user cannot enter.
install -d -o "$SANDBOX_USER" -g "$SANDBOX_USER" -m 0700 "$ZYGOTE_DIR"
# The second mount of the accounts root, which bubblewrap running as the sandbox user mounts folders from.
mkdir -p "$ACCOUNTS_PATH"
grep -q " $ACCOUNTS_PATH none bind" /etc/fstab \
  || printf '%s %s none bind,nofail,x-systemd.requires-mounts-for=%s 0 0\n' "$ACCOUNTS" "$ACCOUNTS_PATH" "$ACCOUNTS" >> /etc/fstab
mountpoint -q "$ACCOUNTS_PATH" || mount "$ACCOUNTS_PATH"
systemctl daemon-reload
echo "install-sandbox-user: $SANDBOX_USER ready; require $ACCOUNTS_PATH in the Host's unit and restart it so $HOST_USER joins its group"
