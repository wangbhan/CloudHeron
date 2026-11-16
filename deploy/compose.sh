#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

env_file=${CLOUDHERON_DOCKER_ENV_FILE:-.env.docker}
if [ ! -r "$env_file" ]; then
  printf >&2 '找不到可读的 Docker 配置 %s。请按部署指南准备 .env.docker。\n' "$env_file"
  exit 1
fi

case ${CLOUDHERON_DOCKER_STORAGE:-local} in
  local) set -- -f compose.storage.yaml "$@" ;;
  external) ;;
  *) printf >&2 'CLOUDHERON_DOCKER_STORAGE 须为 local 或 external。\n'; exit 2 ;;
esac
case ${CLOUDHERON_DOCKER_POSTGRES:-local} in
  local) set -- -f compose.postgres.yaml "$@" ;;
  external) ;;
  *) printf >&2 'CLOUDHERON_DOCKER_POSTGRES 须为 local 或 external。\n'; exit 2 ;;
esac

exec docker compose --env-file "$env_file" -f compose.yaml "$@"
