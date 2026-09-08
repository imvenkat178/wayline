#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node --env-file-if-exists=.env server/server.mjs
