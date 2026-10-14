#!/usr/bin/env bash
# Refuses the two ways a change can reach the default branch without a pull
# request: committing on it locally, and pushing to it. The GitHub ruleset on
# refs/heads/main is the server-side half of the same rule.
set -euo pipefail

mode="${1:-}"

case "$mode" in
  commit)
    branch="$(git symbolic-ref --short -q HEAD || true)"
    if [ "$branch" = main ] || [ "$branch" = master ]; then
      echo "refusing to commit on $branch: switch to a new branch (git switch -c <name>) and open a pull request" >&2
      exit 1
    fi
    ;;
  push)
    status=0
    while read -r _local_ref _local_sha remote_ref _remote_sha; do
      case "$remote_ref" in
        refs/heads/main | refs/heads/master)
          echo "refusing to push to $remote_ref: open a pull request instead" >&2
          status=1
          ;;
      esac
    done
    exit "$status"
    ;;
  *)
    echo "usage: $0 commit|push" >&2
    exit 2
    ;;
esac
