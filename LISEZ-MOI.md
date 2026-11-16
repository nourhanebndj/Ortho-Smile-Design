# Ortho Smile Design — Site vitrine + réservation + dashboard (Firebase)

- **Base de données** : Firebase **Cloud Firestore** (projet `ortho-smile-design`), synchronisée en temps réel.
- **Connexion au dashboard** : Firebase **Authentication** (e-mail + mot de passe).
- **Hébergement** : Firebase **Hosting** (gratuit). En local, `node server.js` sert les pages pour les tester.

---

## 1. Configuration Firebase (une seule fois, ~10 minutes)

Ouvrez https://console.firebase.google.com → projet **ortho-smile-design**.

1. **Authentication** → *Commencer* → onglet *Sign-in method* → activez **Adresse e-mail/Mot de passe**.
2. **Authentication** → onglet *Users* → **Ajouter un utilisateur** : votre e-mail + un mot de passe solide.
3. **Firestore Database** → *Créer une base de données* → mode **production** → emplacement proche (ex. `eur3 (europe-west)`).
4. **Authentication → Paramètres → Actions des utilisateurs** : décochez **« Autoriser la création de comptes »** (seuls les comptes que vous créez dans la console pourront se connecter).
5. **Firestore → Règles** : remplacez tout le contenu par celui du fichier [`firestore.rules`](firestore.rules) puis **Publier**.
   *(ou, avec l'outil Firebase : `npx firebase-tools deploy --only firestore:rules`)*

C'est tout. À la première connexion au dashboard, les paramètres du cabinet, les services et le stock de départ sont créés automatiquement.

> Pour ajouter une assistante : créez-lui simplement un utilisateur (étape 2).

## 2. Tester sur l'ordinateur

Double-cliquez sur **`demarrer.bat`** (ou `node server.js`), puis :
- Site public : http://localhost:3000
- Dashboard : http://localhost:3000/admin (redirige vers /public/admin/)

## 3. Mettre en ligne (Firebase Hosting)

```bash
npx firebase-tools login
npx firebase-tools deploy
```
Le site sera disponible sur **https://ortho-smile-design.web.app** (dashboard : **/admin**) (vous pourrez ensuite relier votre propre nom de domaine dans *Hosting*).

---

## Sécurité (règles Firestore)
- Le public peut **lire** uniquement : infos du cabinet, services, jours fermés et créneaux occupés (sans nom ni téléphone).
- Le public peut seulement **créer** une demande de rendez-vous « en attente », avec validation stricte : nom sans caractères `< > { }`, téléphone au bon format, message limité, date entre aujourd'hui et +92 jours, motif existant, champs imposés. Un créneau déjà pris est refusé.
- Patients, versements, stock, comptabilité, statistiques : **réservés aux comptes e-mail/mot de passe** créés dans la console (l'inscription publique est désactivée).

## Sécurité du site (en-têtes HTTP, `vercel.json`)
- **Content-Security-Policy** : seuls le site, Firebase, Google Fonts/Maps/Analytics et cdnjs peuvent charger du code → bloque l'injection de scripts (XSS).
- **HSTS** (HTTPS obligatoire), **X-Frame-Options / frame-ancestors** (anti-clickjacking), **nosniff**, **Referrer-Policy**, **Permissions-Policy** (caméra, micro, géolocalisation… désactivés).
- **SRI** : Font Awesome et Chart.js sont vérifiés par empreinte ; un fichier modifié sur le CDN serait refusé.
- Dashboard : non indexé, jamais mis en cache, **déconnexion automatique après 30 min d'inactivité**, mot de passe d'au moins 10 caractères (lettres + chiffres) exigé au changement.

## Recommandations à faire dans les consoles
1. **App Check (reCAPTCHA)** dans Firebase : bloque les robots qui enverraient de fausses réservations en masse.
2. **Restreindre la clé API** dans Google Cloud → *API et services* → *Identifiants* : n'autoriser que `ortho-smile-design.vercel.app/*` et `localhost`.
3. **Mot de passe fort** pour le compte du cabinet, et ne jamais le partager par message.
4. Exporter régulièrement les données (Firestore → Import/Export, nécessite la formule Blaze).

## Structure Firestore
| Collection | Contenu |
|---|---|
| `settings/clinic` | nom, téléphone, adresse, réseaux sociaux, horaires, durée des créneaux, pause |
| `services` | soins proposés (tarif, durée, visible sur le site) |
| `appointments` | rendez-vous (en ligne et cabinet) |
| `busy` | créneaux occupés (public, sans données personnelles) |
| `closures` | journées bloquées (congés, jours fériés) |
| `patients`, `treatments`, `payments` | fiches patients, plans de traitement, versements |
| `products`, `stockMoves` | stock et mouvements |
| `expenses` | dépenses (comptabilité) |

## Organisation des fichiers
- `index.html` (à la racine) : page d’accueil du site.
- `public/css`, `public/js`, `public/assets` : styles, scripts et logo du site.
- `public/admin/` : dashboard (`index.html`, `admin.js`, `store.js`, `admin.css`).
- Tous les liens sont **relatifs** : le site fonctionne sur Firebase Hosting, GitHub Pages ou tout hébergement statique.
  Il faut cependant passer par un serveur (pas d’ouverture par double-clic sur `index.html`), car les scripts Firebase sont des modules JavaScript.
