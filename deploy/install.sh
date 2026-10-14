#!/usr/bin/env bash
# =============================================================================
# OpenFamily (foyers) : installation sur un VPS Ubuntu 22.04 / 24.04
# =============================================================================
# À lancer depuis le dossier du projet cloné, en root :
#   sudo bash deploy/install.sh
#
# Ce script :
#   1. installe Docker, Git et le pare-feu (ports 22, 80, 443 seulement) ;
#   2. ajoute de la mémoire d'échange si le VPS a moins de 3 Go de RAM ;
#   3. crée le fichier .env avec des secrets générés (mot de passe de la base,
#      clé de session, clés de notifications) ;
#   4. construit et démarre l'appli, la base, HTTPS (Caddy) et les sauvegardes.
#
# Il peut être relancé sans risque : un .env existant est conservé.
# Variables acceptées pour une installation sans questions : DOMAIN, ACME_EMAIL,
# APP_NAME.
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }

[[ $EUID -eq 0 ]] || die "Lancez ce script en root : sudo bash deploy/install.sh"
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
[[ -f docker-compose.yml && -f deploy/docker-compose.vps.yml ]] || die "Lancez ce script depuis le dossier du projet OpenFamily."
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml)

# ─── 1. Paquets ───────────────────────────────────────────────────────────────
step "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw openssl ca-certificates >/dev/null
ok "curl, git, ufw, openssl"

if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh >/dev/null
    ok "Docker installé"
else
    ok "Docker déjà présent ($(docker --version | cut -d, -f1))"
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Le plugin « docker compose » est absent."

# ─── 2. Pare-feu et mémoire ───────────────────────────────────────────────────
step "Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ok "Seuls SSH (22), HTTP (80) et HTTPS (443) sont ouverts"

mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 3000000 )) && ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "2 Go de mémoire d'échange ajoutés (la construction de l'appli en a besoin)"
fi

# ─── 3. Configuration ─────────────────────────────────────────────────────────
step "Configuration (.env)"
if [[ -f .env ]]; then
    ok ".env existant conservé"
    # shellcheck disable=SC1091
    DOMAIN="${DOMAIN:-$(grep -E '^DOMAIN=' .env | cut -d= -f2-)}"
else
    if [[ -z "${DOMAIN:-}" ]]; then
        read -rp "Nom de domaine de l'appli (ex. maison.mondomaine.com) : " DOMAIN
    fi
    if [[ -z "${ACME_EMAIL:-}" ]]; then
        read -rp "Votre e-mail (avis d'expiration du certificat HTTPS) : " ACME_EMAIL
    fi
    if [[ -z "${APP_NAME:-}" ]]; then
        read -rp "Nom de l'appli sur les téléphones [OpenFamily] : " APP_NAME
    fi
    APP_NAME="${APP_NAME:-OpenFamily}"
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Nom de domaine invalide : $DOMAIN"
    [[ "$ACME_EMAIL" == *@* ]] || die "E-mail invalide : $ACME_EMAIL"
    [[ ${#APP_NAME} -le 30 && "$APP_NAME" != *[\"\$\`\\]* ]] || die "Nom d'appli invalide (30 caractères au plus, sans guillemets) : $APP_NAME"

    umask 077
    cat > .env <<EOF
# Généré par deploy/install.sh le $(date '+%Y-%m-%d'). Gardez ce fichier secret.

# Adresse publique de l'appli et certificat HTTPS
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
APP_PUBLIC_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN

# Base de données
POSTGRES_DB=openfamily
POSTGRES_USER=openfamily
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# Sessions
JWT_SECRET=$(openssl rand -hex 32)

# Notifications (remplies juste après la construction)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:$ACME_EMAIL

# Fuseau horaire de la famille (rappels de rendez-vous)
TZ=Africa/Dakar

# Nom de l'appli sur les téléphones (sous l'icône, dans le menu). Pour le
# changer : modifiez-le ici puis lancez ./deploy/compose.sh up -d --build client
APP_NAME="$APP_NAME"

# Inscriptions : laissez true le temps de créer vos comptes, puis passez à
# false et relancez ./deploy/compose.sh up -d. Les invitations marchent toujours.
REGISTRATION_ENABLED=true

# Sauvegardes quotidiennes conservées (jours)
BACKUP_KEEP_DAYS=14

# E-mails (optionnel) : invitations et mots de passe oubliés par e-mail.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
EOF
    ok ".env créé avec des secrets générés"
fi

# Le domaine doit pointer vers ce serveur, sinon Let's Encrypt refusera le certificat.
public_ip=$(curl -fsS --max-time 5 https://api.ipify.org || true)
domain_ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)
if [[ -n "$public_ip" && "$domain_ip" != "$public_ip" ]]; then
    warn "$DOMAIN pointe vers « ${domain_ip:-rien} », ce serveur est $public_ip."
    warn "Créez un enregistrement DNS de type A : $DOMAIN → $public_ip, puis relancez ce script."
    warn "Je continue : le certificat HTTPS sera obtenu dès que le DNS sera bon."
fi

# ─── 4. Construction et démarrage ─────────────────────────────────────────────
step "Construction des images (quelques minutes la première fois)"
"${COMPOSE[@]}" build

if ! grep -qE '^VAPID_PUBLIC_KEY=.+' .env; then
    keys=$("${COMPOSE[@]}" run --rm --no-deps -T --entrypoint node server \
        -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" | tail -1)
    pub=${keys% *}; priv=${keys#* }
    [[ -n "$pub" && -n "$priv" && "$pub" != "$priv" ]] || die "Génération des clés de notification impossible."
    sed -i "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=$pub|; s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=$priv|" .env
    ok "Clés de notification générées"
fi

step "Démarrage"
mkdir -p backups
chmod +x deploy/*.sh
"${COMPOSE[@]}" up -d
ok "Services démarrés"

echo -n "Attente de l'appli en HTTPS"
for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; then
        echo; ok "https://$DOMAIN répond"
        break
    fi
    echo -n "."; sleep 5
done
echo

cat <<EOF

C'est en ligne : https://$DOMAIN

Étapes suivantes (détaillées dans deploy/README.fr.md) :
  1. Créez votre compte, puis vos autres foyers dans Paramètres → Foyers.
  2. Fermez les inscriptions : REGISTRATION_ENABLED=false dans .env, puis
     ./deploy/compose.sh up -d
  3. Invitez les membres de chaque foyer depuis sa page Famille.

Commandes utiles (depuis $PROJECT_DIR) :
  ./deploy/compose.sh ps            état des services
  ./deploy/compose.sh logs -f       journaux
  ./deploy/update.sh                mettre à jour
  ./deploy/reset-password.sh        changer le mot de passe d'un compte
EOF
