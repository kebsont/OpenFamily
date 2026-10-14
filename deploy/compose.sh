#!/usr/bin/env bash
# Raccourci : docker compose avec les deux fichiers du déploiement VPS.
#   ./deploy/compose.sh ps          état des services
#   ./deploy/compose.sh logs -f     journaux en direct
#   ./deploy/compose.sh up -d       (re)démarrer après un changement de .env
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml "$@"
