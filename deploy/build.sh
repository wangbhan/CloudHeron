#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker build --target api -f backend/Dockerfile -t cloudheron-api:local .
docker build -f app/Dockerfile -t cloudheron-frontend:local .
