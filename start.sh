#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${CLOUDHERON_PYTHON:-}" ]; then
  if [ -x "$ROOT_DIR/backend/.venv/bin/python" ]; then
    CLOUDHERON_PYTHON="$ROOT_DIR/backend/.venv/bin/python"
  elif [ -x "$ROOT_DIR/.work/backend-v020/venv/bin/python" ]; then
    CLOUDHERON_PYTHON="$ROOT_DIR/.work/backend-v020/venv/bin/python"
  else
    CLOUDHERON_PYTHON=python3
  fi
fi
if [ "$#" -eq 0 ]; then set -- start; fi
exec "$CLOUDHERON_PYTHON" "$ROOT_DIR/backend/scripts/manage.py" "$@"
