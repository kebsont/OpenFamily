#!/usr/bin/env bash
# Met à jour l'appli : sauvegarde, récupère le code, reconstruit, redémarre.
#   ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml)

stamp=$(date -u +%Y-%m-%d_%H%M)
mkdir -p backups
echo "→ Sauvegarde avant mise à jour"
"${COMPOSE[@]}" exec -T backup sh -c 'pg_dump --no-owner --clean --if-exists' | gzip > "backups/avant-maj-$stamp.sql.gz"
echo "  backups/avant-maj-$stamp.sql.gz"

before=$(git rev-parse --short HEAD)
echo "→ Récupération du code"
git pull --ff-only
after=$(git rev-parse --short HEAD)

if [[ "$before" == "$after" ]]; then
    echo "Déjà à jour ($after)."
    exit 0
fi

echo "→ Reconstruction ($before → $after)"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d
echo "✓ Mis à jour. En cas de problème : git checkout $before && ./deploy/compose.sh up -d --build"
