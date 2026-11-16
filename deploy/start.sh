#!/bin/sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$#:${1:-}" in
  0:) rebuild=false ;;
  1:--build) rebuild=true ;;
  *) printf >&2 '用法：deploy/start.sh [--build]\n'; exit 2 ;;
esac

"$DEPLOY_DIR/compose.sh" config --quiet
if [ "$rebuild" = true ] ||
   ! docker image inspect cloudheron-api:local cloudheron-frontend:local >/dev/null 2>&1; then
  "$DEPLOY_DIR/build.sh"
fi

set --
if [ "${CLOUDHERON_DOCKER_POSTGRES:-local}" = local ]; then set -- "$@" postgres; fi
if [ "${CLOUDHERON_DOCKER_STORAGE:-local}" = local ]; then set -- "$@" object-storage; fi
if [ "$#" -gt 0 ]; then
  "$DEPLOY_DIR/compose.sh" up -d --wait --wait-timeout 120 "$@"
fi

"$DEPLOY_DIR/compose.sh" up -d --no-build --wait --wait-timeout 180
"$DEPLOY_DIR/compose.sh" ps
