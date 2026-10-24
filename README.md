# LabPerformance — Site vitrine VO2max (La Réunion)

Ce dépôt contient une page statique simple pour présenter un laboratoire de
performance réalisant des tests de VO2max à La Réunion.

Fichiers créés:

- [index.html](index.html)
- [styles.css](styles.css)

Instructions rapides:

1. Placez une photo du Cirque de Mafate dans `assets/mafate.jpg`.
   - Nom exact: `assets/mafate.jpg` (créez le dossier `assets` si nécessaire).

2. Installation et lancement (serveur Express inclus):

```bash
cd /Users/maxmo/Desktop/VO2
npm install
npm start
# puis ouvrez http://localhost:3000 dans votre navigateur
```

3. Le formulaire de réservation est maintenant fonctionnel :
- Les soumissions sont enregistrées dans `submissions.json`.
- Optionnel : pour que le serveur envoie un email de notification, copiez
  `.env.example` en `.env` et remplissez les variables SMTP (host, user, pass,
  etc.). Le serveur utilisera ces valeurs pour envoyer un email à
  l'adresse `NOTIFY_TO`.

Exemple minimal de `.env` (voir `.env.example` fourni) :

```
PORT=3000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=utilisateur@example.com
SMTP_PASS=motdepasse
NOTIFY_TO=votre.email@domaine.com
```

Le serveur est volontairement simple : il sert les fichiers statiques,
reçoit les réservations et les conserve localement. Si vous souhaitez une
intégration directe avec un service d'emailing ou un calendrier (Calendly,
Google Calendar), je peux l'ajouter.

Nouvelle fonctionnalité : gestion d'utilisateurs
- L'utilisateur peut créer un compte via l'interface (`Se connecter / S'inscrire`).
- Les comptes sont enregistrés dans `users.json` avec un hash de mot de passe.
- Point d'API : `POST /api/register` (body JSON: `name`, `email`, `password`).

Sécurité : Ce stockage local est destiné à des démos ou environnements de
test. Pour la production, utilisez une base de données sécurisée et des
pratiques d'authentification robustes (sessions, JWT, validation email).

Stripe & variables d'environnement
- Pour activer le paiement Stripe, définissez les variables d'environnement suivantes dans `.env` :

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_CENTS=3000   # montant en centimes (ex: 3000 == 30.00 EUR)
STRIPE_CURRENCY=eur
JWT_SECRET=une_chaine_secrete
```

Le flux actuel crée une session Stripe Checkout et redirige le client vers
la page de paiement. Les réservations sont enregistrées avec le statut
`pending` dans `bookings.json`. Pour confirmation automatique après
paiement, il faudra utiliser un webhook Stripe pour valider la session et
mettre à jour le statut.
