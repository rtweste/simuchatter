# Simulateur Chatter — guide de mise en ligne

Site d'entraînement pour vos chatters. Chaque chatter se connecte avec un identifiant que vous lui donnez. Il discute avec un fan simulé par l'IA, puis reçoit une note sur 100. Vous voyez tous les résultats dans l'**espace manager**.

---

## Ce qu'il vous faut

1. **Une clé d'API Anthropic** : c'est elle qui fait jouer le fan. Elle est facturée à l'usage.
2. **Un compte GitHub** (gratuit) : il sert à stocker le code.
3. **Un compte Railway** (hébergeur) : il met le site en ligne. Il faut un abonnement payant, voir [railway.com/pricing](https://railway.com/pricing).

Comptez environ 20 minutes, sans rien installer sur votre ordinateur.

---

## Étape 1 — Créer la clé d'API

1. Allez sur [console.anthropic.com](https://console.anthropic.com) et créez un compte.
2. Ouvrez **Billing** et ajoutez du crédit. Une petite somme suffit pour commencer.
3. Ouvrez **API Keys**, puis cliquez sur **Create Key**.
4. Copiez la clé (elle commence par `sk-ant-`) et gardez-la de côté. Ne la partagez avec personne.

> Astuce : dans **Limits**, fixez un plafond de dépense mensuel. Vous ne serez jamais surpris par la facture.

## Étape 2 — Mettre le code sur GitHub

1. Créez un compte sur [github.com](https://github.com).
2. Cliquez sur **+** puis **New repository**. Donnez-lui un nom (par exemple `simulateur-chatter`), cochez **Private** et cliquez sur **Create repository**.
3. Sur la page du dépôt, cliquez sur **uploading an existing file**.
4. Dézippez le fichier que je vous ai envoyé. Glissez-déposez **tout le contenu du dossier** : les fichiers et le dossier `public`.
5. Cliquez sur **Commit changes**.

## Étape 3 — Mettre en ligne avec Railway

1. Allez sur [railway.com](https://railway.com) et connectez-vous avec votre compte GitHub.
2. Cliquez sur **New Project**, puis **Deploy from GitHub repo**, et choisissez votre dépôt.
3. **Ajoutez un stockage** pour que les résultats ne soient pas perdus. Faites un clic droit sur le service, choisissez **Attach volume** et indiquez comme chemin de montage : `/data`.
4. Ouvrez l'onglet **Variables** du service et ajoutez :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | votre clé `sk-ant-…` |
| `ADMIN_USER` | votre identifiant manager (ex. `manager`) |
| `ADMIN_PASSWORD` | un mot de passe solide |
| `DB_PATH` | `/data/app.db` |
| `NODE_ENV` | `production` |

5. Ouvrez **Settings**, puis **Networking**, et cliquez sur **Generate Domain**. Vous obtenez l'adresse de votre site, du type `simulateur-chatter.up.railway.app`. Vous pourrez brancher votre propre nom de domaine plus tard au même endroit.
6. Attendez que le déploiement passe au vert, puis ouvrez l'adresse.

## Étape 4 — Ajouter vos chatters

1. Connectez-vous avec `ADMIN_USER` / `ADMIN_PASSWORD`.
2. Dans l'onglet **Créatrices**, adaptez le profil d'exemple (Léa) ou ajoutez les vôtres : style d'écriture, centres d'intérêt, grille de prix.
3. Dans l'onglet **Chatters**, créez un compte par chatter.
4. Envoyez à chaque chatter l'adresse du site, son identifiant et son mot de passe.

---

## Réglages optionnels (variables Railway)

| Variable | Par défaut | Rôle |
|---|---|---|
| `DAILY_SIM_LIMIT` | `10` | Nombre max de simulations par chatter et par jour (contrôle des coûts) |
| `MAX_MESSAGES_PER_SIM` | `40` | Nombre max de messages du chatter par simulation |
| `MODEL_FAN` | `claude-haiku-5-5` | Modèle qui joue le fan |
| `MODEL_EVAL` | `claude-sonnet-5-5` | Modèle qui note la session |
| `MODEL_HINT` | `claude-haiku-5-5` | Modèle du coach (conseils) |

Le fan tourne sur `claude-haiku-5-5` (économique). Pour un fan un peu plus réaliste mais plus cher, mettez `MODEL_FAN` sur `claude-sonnet-5-5`. Les tarifs sont sur [docs.claude.com](https://docs.claude.com).

## Modifier les profils de fans

Les 6 profils sont dans `personas.js`. Pour en ajouter un, copiez un bloc et changez l'`id` et les textes. Ensuite, modifiez le fichier sur GitHub (icône crayon) : Railway redéploie tout seul.

## Tester sur votre ordinateur (facultatif)

Il faut avoir Node.js 20 ou plus.
```
npm install
npm run dev
```
Puis ouvrez http://localhost:3000 avec l'identifiant `admin` et le mot de passe `admin123`. En mode `dev`, l'IA est simulée : les réponses du fan sont factices et rien n'est facturé.

## Sécurité

- La clé d'API reste sur le serveur. Les chatters ne la voient jamais.
- Les mots de passe sont chiffrés.
- Les consignes cachées des profils de fans ne sont jamais envoyées aux chatters.
- Désactiver un chatter le déconnecte immédiatement.

## Sauvegardes et restauration

Le site fait une copie de la base chaque nuit vers 4 h (heure de Paris) dans le volume Railway, dossier `/data/backups`. On garde les 14 dernières nuits, une par semaine sur 8 semaines et les 5 dernières sauvegardes manuelles. Tout se gère dans **Réglages fondateur → Sauvegardes** : sauvegarder maintenant, télécharger une sauvegarde, ou télécharger l'**archive complète** (base + captures de ventes, photos, fichiers du chat). Télécharge l'archive complète une fois par semaine sur ton ordinateur : un rappel arrive chaque lundi.

**Revenir à une sauvegarde de nuit (la base est abîmée ou une erreur a tout cassé) :**
1. Dans Réglages fondateur → Sauvegardes, repère le nom de la sauvegarde voulue (ex. `stellads-2026-11-19-0400.db` : passe la souris sur le lien de téléchargement pour voir le nom).
2. Sur Railway, ouvre le service → **Variables** → ajoute `RESTORE_BACKUP` = ce nom de fichier, puis laisse Railway redéployer.
3. Au démarrage, le site met la base actuelle de côté (`avant-restauration-….db`) puis remet la sauvegarde. Une fois le site revenu, **supprime la variable** `RESTORE_BACKUP` (elle ne s'applique qu'une fois, mais autant la retirer).

**Si le volume entier est perdu :** crée un nouveau volume monté sur `/data`, puis remets-y le contenu de ta dernière archive complète (le fichier `app.db` et les dossiers `uploads`, `chat`, `studio`). Railway propose aussi ses propres sauvegardes de volume dans les réglages du volume : active-les si ton offre le permet.
