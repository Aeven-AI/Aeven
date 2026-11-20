#!/bin/sh
# gh inside a jail: GitHub API reads go to the egress proxy's read-only route. With GH_HOST github.localhost, gh sends
# plain HTTP to api.github.localhost through HTTP_PROXY; the proxy puts the account's GitHub credential in place of the
# placeholder token below and refuses every write. NO_PROXY drops `localhost`, which would otherwise send
# api.github.localhost past the proxy. Pass `--repo owner/name`: Git remotes inside a jail point at the proxy.
export GH_HOST=github.localhost GH_TOKEN=aeven-egress-proxy
export GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1 GH_SPINNER_DISABLED=1
export NO_PROXY=127.0.0.1,::1 no_proxy=127.0.0.1,::1
exec /usr/bin/gh "$@"
