#!/usr/bin/env bash
set -euo pipefail
# Optional one-time setup for the extracted tar.gz build on Ubuntu hosts that
# disallow unprivileged Chromium user namespaces. Never disables the sandbox.
app_dir="$(cd -- "${1:?Usage: prepare-linux-sandbox.sh /absolute/path/to/extracted-app}" && pwd -P)"
helper="$app_dir/chrome-sandbox"
if [[ ! -f "$helper" || -L "$helper" || ! -x "$app_dir/si-remote" ]]; then
  echo 'Choose the extracted SI Remote app directory containing si-remote and chrome-sandbox.' >&2
  exit 1
fi
echo "This configures the bundled Chromium sandbox helper: $helper"
echo 'Only continue for the trusted, verified SI Remote build you extracted.'
sudo chown root:root -- "$helper"
sudo chmod 4755 -- "$helper"
echo 'Sandbox helper configured. Run si-remote normally; no --no-sandbox flag is needed.'
