#!/usr/bin/env bash
# Compila las 5 imágenes propias del proyecto y las publica en GHCR
# (GitHub Container Registry), para que el servidor solo tenga que hacer
# `docker compose pull` en vez de compilar TypeScript en la instancia.
#
# Uso:
#   export GHCR_USER=mateod01
#   echo <tu-token-con-scope-write:packages> | docker login ghcr.io -u $GHCR_USER --password-stdin
#   ./scripts/publish-images.sh [tag]      # tag por defecto: latest

set -euo pipefail

TAG="${1:-latest}"
GHCR_USER="${GHCR_USER:?Definí GHCR_USER, ej: export GHCR_USER=mateod01}"
REGISTRY="ghcr.io/${GHCR_USER}/evolution-iot-demo"

SERVICES=(plc-simulator collector plc-simulator-pinedo collector-pinedo processor)

cd "$(dirname "$0")/.."

for svc in "${SERVICES[@]}"; do
  echo "== building ${svc} =="
  docker build -t "${REGISTRY}-${svc}:${TAG}" "./apps/${svc}"
  echo "== pushing ${svc} =="
  docker push "${REGISTRY}-${svc}:${TAG}"
done

echo "OK — imágenes publicadas en ${REGISTRY}-*:${TAG}"
