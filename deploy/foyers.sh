#!/usr/bin/env bash
# Qui est dans quel foyer, et les derniers repas ajoutés (lecture seule).
# Utile quand une saisie « n'apparaît pas » : elle a souvent été faite depuis
# un compte qui n'est pas dans le foyer que l'on regarde.
#   ./deploy/foyers.sh
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml exec -T postgres \
    sh -c 'psql -X -q -P pager=off -P footer=off -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
\echo
\echo 'Foyers et comptes'
\echo '================='
WITH foyer AS (
    SELECT u.id,
           COALESCE(NULLIF(la.label, ''), 'Famille de ' || u.name) AS nom,
           la.group_id
    FROM users u
    LEFT JOIN linked_accounts la ON la.user_id = u.id
    WHERE u.family_owner_id IS NULL
)
SELECT f.nom AS foyer,
       CASE WHEN m.email LIKE '%@accounts.invalid' THEN '(foyer ouvert depuis le menu Foyers)' ELSE m.name END AS compte,
       CASE WHEN m.email LIKE '%@accounts.invalid' THEN '' ELSE m.email END AS email,
       CASE WHEN m.id = f.id THEN 'propriétaire' ELSE COALESCE(m.role, 'membre') END AS role
FROM foyer f
JOIN users m ON m.id = f.id OR m.family_owner_id = f.id
ORDER BY f.group_id NULLS LAST, f.nom, (m.id = f.id) DESC, m.name;

\echo
\echo 'Repas ajoutés ou modifiés ces 3 derniers jours'
\echo '==============================================='
SELECT COALESCE(NULLIF(la.label, ''), 'Famille de ' || u.name) AS foyer,
       to_char(mp.date, 'DD/MM') AS jour,
       mp.meal_type AS repas,
       LEFT(COALESCE(r.name, mp.custom_meal, ''), 40) AS plat,
       to_char(COALESCE(mp.updated_at, mp.created_at), 'DD/MM HH24:MI') AS saisi
FROM meal_plans mp
JOIN users u ON u.id = mp.user_id
LEFT JOIN linked_accounts la ON la.user_id = u.id
LEFT JOIN recipes r ON r.id = mp.recipe_id
WHERE COALESCE(mp.updated_at, mp.created_at) > now() - interval '3 days'
ORDER BY COALESCE(mp.updated_at, mp.created_at) DESC
LIMIT 30;

\echo
\echo 'Un compte seul dans « Famille de … » a été créé avec « S\'inscrire » au lieu du lien'
\echo 'd\'invitation : ses saisies restent chez lui. Ouvre-lui à nouveau le lien d\'invitation'
\echo 'du bon foyer, connecté à son compte, pour qu\'il rejoigne ce foyer.'
SQL
