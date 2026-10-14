#!/bin/sh
# Sauvegarde quotidienne de la base, conservée KEEP_DAYS jours dans ./backups.
# Restauration : voir deploy/README.fr.md.
set -u

KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p /backups

while true; do
    file="/backups/openfamily-$(date -u +%Y-%m-%d_%H%M).sql.gz"
    if pg_dump --no-owner --clean --if-exists | gzip > "$file.tmp"; then
        mv "$file.tmp" "$file"
        echo "$(date -u '+%F %T') sauvegarde OK : $file"
    else
        rm -f "$file.tmp"
        echo "$(date -u '+%F %T') ÉCHEC de la sauvegarde" >&2
    fi
    find /backups -name 'openfamily-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
    sleep 86400
done
