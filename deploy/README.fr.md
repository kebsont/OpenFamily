# OpenFamily « foyers » : installation sur un VPS

Cette version d'OpenFamily gère plusieurs foyers depuis un seul compte :

- chaque foyer est une famille OpenFamily séparée. Ses membres ne voient jamais les autres foyers, ni même qu'il en existe ;
- le propriétaire a un seul compte. Il passe d'un foyer à l'autre depuis le menu en haut de l'écran, sans se déconnecter ;
- les notifications de tous ses foyers arrivent sur son téléphone.

Il faut compter environ 30 minutes la première fois.

## Ce qu'il te faut

- **Un VPS** sous Ubuntu 24.04. Par exemple un VPS-1 chez OVHcloud, avec un datacenter en France pour la latence depuis Dakar. 2 Go de RAM suffisent.
- **Un nom de domaine** ou un sous-domaine, par exemple `maison.ton-domaine.com`.
- Ton fork GitHub de ce projet.

## 1. Pointer le domaine vers le VPS

Chez ton registrar, crée un enregistrement DNS :

| Type | Nom | Valeur |
|---|---|---|
| A | `maison` | adresse IP du VPS |

La propagation prend de quelques minutes à une heure.

## 2. Installer

Connecte-toi au VPS (`ssh root@IP_DU_VPS` ou `ssh ubuntu@IP_DU_VPS`), puis :

```bash
sudo git clone https://github.com/TON-COMPTE/OpenFamily.git /opt/openfamily
cd /opt/openfamily
sudo bash deploy/install.sh
```

Le script te demande le domaine et ton e-mail, puis il :

- installe Docker et ferme tous les ports sauf SSH, HTTP et HTTPS ;
- génère tous les secrets dans `.env` ;
- construit l'appli et la démarre en HTTPS ;
- programme une sauvegarde quotidienne de la base.

À la fin, il affiche `C'est en ligne : https://maison.ton-domaine.com`.

## 3. Créer les foyers (un seul compte)

1. Ouvre `https://maison.ton-domaine.com` et **crée ton compte**, avec ton adresse e-mail habituelle. Ce compte est ton **premier foyer**.
2. Va dans **Paramètres → Foyers → Créer un autre foyer**. Donne un nom à chaque foyer, par exemple « Maison principale » et « Deuxième maison », puis valide avec **Créer et ouvrir**.

   Le nouveau foyer s'ouvre aussitôt. Le menu en haut de l'écran affiche le foyer ouvert et permet de passer de l'un à l'autre. Tu gardes un seul e-mail et un seul mot de passe pour tous.
3. **Ferme les inscriptions** pour que personne d'autre ne puisse créer de compte. Les invitations continueront de fonctionner.
   ```bash
   cd /opt/openfamily
   sudo sed -i 's/^REGISTRATION_ENABLED=.*/REGISTRATION_ENABLED=false/' .env
   sudo ./deploy/compose.sh up -d
   ```

Dans chaque foyer, les membres te voient sous ton nom, avec ta photo et ton e-mail. Si tu changes de nom ou de photo, le changement passe dans les autres foyers à la bascule suivante.

## 4. Inviter les membres de chaque foyer

Avant d'inviter, **vérifie le nom du foyer affiché en haut de l'écran**.

1. Ouvre le premier foyer. Va dans **Famille → Inviter**, choisis le rôle **Parent** et copie le lien.
2. Envoie ce lien, par WhatsApp par exemple. La personne crée son compte en l'ouvrant.
3. Passe à l'autre foyer depuis le menu du haut et fais de même.

Un lien d'invitation ne sert qu'une fois et expire au bout de 7 jours.

Avec le rôle Parent, un membre gère tout dans son foyer : courses, budget, agenda, recettes, enfants. En revanche, il ne peut ni te retirer, ni changer les rôles, ni voir un autre foyer. Tu restes propriétaire de tous tes foyers.

Rien dans l'appli ne montre aux membres d'un foyer que tu en as d'autres : le menu des foyers, la carte **Foyers** des Paramètres et la vue d'ensemble des achats n'apparaissent que pour toi. Ce qu'ils voient de toi (nom, photo, e-mail) est identique partout.

## 5. Sur les téléphones

- **Android :** ouvre l'adresse dans Chrome, puis menu ⋮ → **Installer l'application**.

  Tu peux aussi installer l'APK OpenFamily : à l'ouverture, saisis l'adresse `https://maison.ton-domaine.com`.
- **iPhone :** ouvre l'adresse dans Safari, puis **Partager → Sur l'écran d'accueil**. Un bandeau le rappelle tant que l'appli n'est pas installée. Sur iPhone, les notifications ne marchent que dans l'appli ouverte depuis son icône (iOS 16.4 ou plus récent).

L'appli porte le nom choisi à l'installation, sous l'icône et sur l'icône elle-même. Pour le changer : ligne `APP_NAME` du fichier `.env`, puis `sudo ./deploy/compose.sh up -d --build client`. Les téléphones déjà installés gardent l'ancienne icône jusqu'à ce qu'on la retire de l'écran d'accueil et qu'on l'ajoute à nouveau.

Sur chaque téléphone :

- **Paramètres → Notifications** : active les rappels.
- **Paramètres → Devise** : choisis **Franc CFA**.

Pour recevoir aussi les rappels des autres foyers, ouvre chacun une fois depuis le menu du haut après avoir activé les notifications.

Sur ton téléphone, les notifications de tous tes foyers s'affichent sur l'écran verrouillé. Pour n'y montrer que le nom de l'appli :

- **iPhone :** Réglages → Notifications → l'appli → **Afficher les aperçus : Si déverrouillé** ;
- **Android :** Paramètres → Notifications → Notifications sur l'écran de verrouillage → **Masquer le contenu sensible** (le libellé varie selon la marque).

## 6. Achats : tickets Auchan, Woyofal, petites dépenses

Le menu **Achats** (☰, ou le bouton rond **+** → **Scanner un ticket** / **Recharge Woyofal**) regroupe trois saisies :

- **Scanner un ticket** : photo du ticket de caisse (2 ou 3 photos s'il est long). Chaque ligne est lue, rangée par rayon et ajoutée au budget. On relit avant d'enregistrer : un bandeau signale si la somme des lignes ne tombe pas sur le total.
- **Recharge Woyofal** : montant et kWh reçus (indiqués sur le reçu ou le SMS). L'appli calcule le prix du kWh et le total du mois.
- **Petite dépense** : marché, quincaillerie… avec ce qui a été acheté. Pour la boutique du coin, il y a plus simple : l'onglet **Boutique** (section 8).

L'onglet **Analyse** compare le mois choisi au mois précédent : par magasin, par rayon, produits les plus achetés (avec l'évolution des prix), électricité, et les achats répétés à la boutique. Le bouton **À la liste** ajoute ces derniers à la liste de courses, pour les prendre en gros à Auchan le mois suivant.

Chaque foyer ne voit que ses achats. Toi seul as en plus l'onglet **Foyers**, qui les met côte à côte.

### Activer la lecture des tickets

La lecture des tickets utilise un service d'IA en ligne, avec ta propre clé. **Dans chaque foyer** (ouvre-le depuis le menu du haut) :

1. **Paramètres → Assistant IA**.
2. Choisis le fournisseur (**Anthropic Claude**, **API compatible OpenAI** ou **Google Gemini**), colle la clé API, indique un modèle récent : ils lisent tous les images.
3. Laisse **Assistant activé** coché, clique **Tester la connexion**, puis **Enregistrer**.

La même clé peut servir à tous les foyers. Un ticket coûte quelques francs CFA (environ 10 à 20 F CFA avec un modèle rapide, plus avec un grand modèle). Les photos partent chez ce fournisseur pour être lues ; elles ne sont pas conservées sur le VPS.

Sans clé, les recharges Woyofal et les petites dépenses fonctionnent quand même.

## 7. Les courses du mois

Le menu **Courses** (onglet **Listes** sur téléphone) est une liste par mois, qui s'écrit comme dans Notes :

- un produit par ligne, **Entrée** pour passer au suivant. Plusieurs lignes collées d'un coup sont toutes ajoutées ;
- on coche dans le magasin. Un appui sur un produit le corrige, la croix le retire ;
- les flèches à côté du mois remontent aux listes des mois précédents, telles qu'elles étaient : c'est l'historique.

En début de mois, un bouton ajoute d'un coup les **produits habituels** : ceux achetés presque chaque mois, ceux qui reviennent tous les deux ou trois mois quand c'est le moment, et ceux pris plusieurs fois à la boutique le mois d'avant (sauf le pain et les autres produits frais du jour). On retire ensuite ce qui n'est pas fini. Les autres produits déjà achetés restent proposés sous la liste, d'un appui.

**Pour démarrer**, colle une fois dans chaque foyer ses anciennes listes (Notes, WhatsApp) dans **Anciennes listes**, plusieurs mois d'un coup : les titres comme « Courses du mois de juillet » séparent les mois, et les cases déjà cochées le restent.

Ce que les recettes ou les menus ajoutent à la liste de courses apparaît sous **Aussi à acheter**. La liste détaillée d'origine (rayons, prix, modèles) reste accessible en bas de la page.

Quand des tickets sont scannés, l'IA reprend les noms des listes (« Huile », « Omo »…) : les achats et les listes se comparent directement.

## 8. La boutique du coin

Les petits achats de tous les jours (pain, poivre, chips, aiguille, charbon…) ont leur propre carnet : onglet **Boutique**, à côté de **Courses du mois** sur la même page, ou bouton rond **+** → **Achat boutique**.

- **Quoi ?** et **Prix**, puis **Ajouter**. Les produits pris souvent sont proposés avec leur dernier prix : un appui remplit les deux champs.
- **Payé** ou **À crédit** : ce qui est pris à crédit s'additionne dans l'encadré **À payer à la boutique**. Le jour où le boutiquier est payé, **C'est réglé** passe tout en payé d'un coup. Un appui sur l'étiquette **Payé / À crédit** d'une ligne la change seule.
- **Moi** ou **La bonne** : qui a fait l'achat. Ces deux choix et le mode de paiement restent mémorisés sur le téléphone.
- **Jour** : pour noter après coup un achat de la veille.

Chaque achat est aussi une dépense du budget (catégorie Alimentation, Maison, Enfants ou Santé selon le produit), y compris ceux pris à crédit : le budget suit ce qui est consommé, l'encadré suit ce qui reste dû.

La différence avec les courses du mois : la liste du mois prépare les grosses courses (Auchan, marché) et se coche au magasin ; le carnet de la boutique enregistre après coup des petites sommes, presque chaque jour. Dans **Achats → Analyse**, ces achats forment la ligne **Petits achats**, et ce qui est pris plusieurs fois dans le mois (sauf le pain et les produits frais) est proposé pour la liste du mois suivant, pour l'acheter en gros.

## Au quotidien

Toutes les commandes se lancent depuis `/opt/openfamily`, avec `sudo`.

| Besoin | Commande |
|---|---|
| Voir si tout tourne | `./deploy/compose.sh ps` |
| Lire les journaux | `./deploy/compose.sh logs -f --tail=100` |
| Changer le mot de passe d'un compte | `./deploy/reset-password.sh adresse@e-mail` |
| Mettre à jour | `./deploy/update.sh` |

### Mot de passe oublié

Sans serveur d'e-mail configuré, l'appli ne peut pas envoyer de lien de réinitialisation. Utilise `reset-password.sh` (voir le tableau). Tu peux aussi remplir les lignes `SMTP_*` du fichier `.env`.

### Récupérer les nouveautés du projet d'origine

1. Sur GitHub, dans ton fork, clique sur **Sync fork → Update branch**.
2. Sur le VPS, lance `./deploy/update.sh`.

Le script fait une sauvegarde avant chaque mise à jour.

### Sauvegardes

Une sauvegarde est faite chaque jour dans `/opt/openfamily/backups`. Elle est conservée 14 jours, durée réglable avec `BACKUP_KEEP_DAYS` dans `.env`.

Elles restent sur le VPS. **Copie-les de temps en temps ailleurs.** Depuis ton PC :

```bash
scp -r root@IP_DU_VPS:/opt/openfamily/backups ./sauvegardes-openfamily
```

Pour **restaurer** une sauvegarde :

```bash
cd /opt/openfamily
sudo ./deploy/compose.sh stop server
gunzip -c backups/openfamily-AAAA-MM-JJ_HHMM.sql.gz \
  | sudo ./deploy/compose.sh exec -T postgres psql -U openfamily -d openfamily
sudo ./deploy/compose.sh start server
```

## Ce que cette version change par rapport à OpenFamily

| Changement | Pourquoi |
|---|---|
| Plusieurs foyers pour un seul compte, menu « Foyers » | Le propriétaire crée ses foyers depuis Paramètres et passe de l'un à l'autre sans se déconnecter. Personne d'autre ne gagne d'accès. Il est aussi possible de lier des comptes séparés existants, avec leur mot de passe. |
| Le foyer d'une session est relu en base à chaque requête | Avant, un membre retiré d'une famille gardait l'accès à ses données jusqu'à 7 jours, le temps que sa session expire. |
| Synchro en temps réel pour les membres | Avant, seul le propriétaire voyait les changements des autres sans recharger la page. |
| Courses du mois | Une liste par mois écrite comme une note, cochée au magasin, avec l'historique des mois précédents et les produits habituels en un appui. |
| Carnet de la boutique | Les petits achats du quotidien, payés ou à crédit, avec ce qui reste dû à la boutique et qui a fait l'achat. |
| Bandeau d'installation sur iPhone, nom de l'appli au choix | Sur iPhone, l'appli doit être ajoutée à l'écran d'accueil pour s'ouvrir en plein écran et recevoir les notifications. |
| Menu « Achats » | Tickets de caisse lus par l'IA, recharges Woyofal, petites dépenses, et comparaison d'un mois à l'autre. Tout s'ajoute aussi au budget. |
| Franc CFA dans les devises | — |
| Dossier `deploy/` | HTTPS automatique, aucun port de la base ou du serveur ouvert sur Internet, sauvegardes quotidiennes, scripts d'installation et de mise à jour. |
