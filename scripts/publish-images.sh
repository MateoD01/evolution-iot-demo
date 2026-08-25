#!/usr/bin/env bash
# Compila las 5 imágenes propias del proyecto y las publica en el Docker Registry
# privado que corre en el servidor (docker-compose.registry.yml), para que el
# servidor solo tenga que hacer `docker compose pull` en vez de compilar
# TypeScript en la instancia.
#
# Uso (desde la notebook):
#   export REGISTRY_HOST=<ip-publica-o-elastic-ip>:5000
#   docker login $REGISTRY_HOST                 # user/clave del htpasswd del registry
#   ./scripts/publish-images.sh [tag]            # tag por defecto: latest

set -euo pipefail

TAG="${1:-latest}"
REGISTRY_HOST="${REGISTRY_HOST:?Definí REGISTRY_HOST, ej: export REGISTRY_HOST=1.2.3.4:5000}"
REGISTRY="${REGISTRY_HOST}/evolution-iot-demo"

SERVICES=(plc-simulator collector plc-simulator-pinedo collector-pinedo processor)

cd "$(dirname "$0")/.."

for svc in "${SERVICES[@]}"; do
  echo "== building ${svc} =="
  docker build -t "${REGISTRY}-${svc}:${TAG}" "./apps/${svc}"
  echo "== pushing ${svc} =="
  docker push "${REGISTRY}-${svc}:${TAG}"
done

echo "OK — imágenes publicadas en ${REGISTRY}-*:${TAG}"
