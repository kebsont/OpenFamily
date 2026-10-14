#!/usr/bin/env bash
# Change le mot de passe d'un compte (utile sans e-mails configurés).
#   ./deploy/reset-password.sh prenom@exemple.com
set -euo pipefail
cd "$(dirname "$0")/.."

email="${1:-}"
[[ -n "$email" ]] || { echo "Usage : $0 adresse@e-mail"; exit 1; }
read -rsp "Nouveau mot de passe (8 caractères minimum) : " password; echo
[[ ${#password} -ge 8 ]] || { echo "Trop court : 8 caractères minimum."; exit 1; }

docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml exec -T \
    -e TARGET_EMAIL="$email" -e NEW_PASSWORD="$password" server node -e '
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
(async () => {
    const pool = new Pool({
        host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
        database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    });
    const hash = await bcrypt.hash(process.env.NEW_PASSWORD, 12);
    const r = await pool.query("UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)", [hash, process.env.TARGET_EMAIL.trim()]);
    console.log(r.rowCount ? "✓ Mot de passe changé." : "Aucun compte avec cet e-mail.");
    await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });'
