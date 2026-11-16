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

# Validate the environment received by the API before starting the stack.
"$DEPLOY_DIR/compose.sh" run --rm --no-deps -T api python -c '
import os
from cloudheron.security import Vault

try:
    Vault(os.environ["VAULT_KEY_B64"])
except ValueError:
    raise SystemExit(
        "VAULT_KEY_B64 无效：请在 Docker 配置中填入 32 字节密钥的 Base64 值。已有模型密钥的部署须沿用原密钥。"
    ) from None
'

set --
if [ "${CLOUDHERON_DOCKER_POSTGRES:-local}" = local ]; then set -- "$@" postgres; fi
if [ "${CLOUDHERON_DOCKER_STORAGE:-local}" = local ]; then set -- "$@" object-storage; fi
if [ "$#" -gt 0 ]; then
  "$DEPLOY_DIR/compose.sh" up -d --wait --wait-timeout 120 "$@"
fi

"$DEPLOY_DIR/compose.sh" up -d --no-build --wait --wait-timeout 180
"$DEPLOY_DIR/compose.sh" ps
