#!/bin/sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -ne 0 ]; then
  printf >&2 '用法：deploy/stop.sh\n'
  exit 2
fi

# Keep PostgreSQL and S3 available while FastAPI drains active tasks.
"$DEPLOY_DIR/compose.sh" stop frontend api
set --
if [ "${CLOUDHERON_DOCKER_POSTGRES:-local}" = local ]; then set -- "$@" postgres; fi
if [ "${CLOUDHERON_DOCKER_STORAGE:-local}" = local ]; then set -- "$@" object-storage; fi
if [ "$#" -gt 0 ]; then
  "$DEPLOY_DIR/compose.sh" stop "$@"
fi
