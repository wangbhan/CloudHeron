#!/bin/sh
set -eu
BACKEND_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$BACKEND_DIR"
exec "${CLOUDHERON_PYTHON:-python3}" -m uvicorn cloudheron.main:create_app --factory --host "${HOST:-127.0.0.1}" --port "${PORT:-8802}" --workers 1
