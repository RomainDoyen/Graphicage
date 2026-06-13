# Graphicage TER

Application web d'optimisation de tournées de **transport scolaire** à La Réunion. Migration modernisée du projet [GraphicageTER](https://github.com/Flaxib/voyageur-de-commerce).

## Parcours utilisateur

1. **Landing page** (`/`) — présentation du projet  
2. **Inscription / connexion** (`/compte/…`)  
3. **Application** (`/app/`) — carte, calcul OR-Tools, historique  

## Fonctionnalités

### Application (`/app/`)

- Carte interactive **Leaflet** (OpenStreetMap) centrée sur Saint-Denis
- Recherche de lieux (Éducation nationale, Géoplateforme, catalogue admin, OSM)
- Optimisation **OR-Tools** — TSP et Pickup & Delivery
- Capacité bus, fenêtres horaires, créneaux par défaut (ramassage / école)
- Multi-bus coloré, vue par école, comparaison de scénarios
- Résumé post-calcul (distance, durée, carburant / CO₂ estimés)
- Exports CSV, GPX, impression feuille de route
- Persistance locale (localStorage), partage par URL, undo
- Import / export JSON

### Comptes & données

- Inscription, connexion, mot de passe oublié (formulaires avec validation visuelle)
- **Historique automatique** de chaque itinéraire calculé (onglet Historique)
- Sauvegarde manuelle de tournées (`SavedScenario`)
- Catalogue de lieux via admin Django (`CatalogPoint`)
- Base **Neon Postgres** ou SQLite en local

## Démarrage rapide (Linux / macOS)

```bash
cd graphicage-ter-app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

Windows : remplacer `source .venv/bin/activate` par `.venv\Scripts\activate`.

| URL | Description |
|-----|-------------|
| http://localhost:8000/ | Landing page |
| http://localhost:8000/app/ | Application (connexion requise) |
| http://localhost:8000/compte/inscription/ | Créer un compte |
| http://localhost:8000/documentation/ | Documentation HTML |
| http://localhost:8000/admin/ | Admin Django (`createsuperuser`) |

## Comptes utilisateurs

| Page | URL |
|------|-----|
| Accueil | `/` |
| Application | `/app/` |
| Inscription | `/compte/inscription/` |
| Connexion | `/compte/connexion/` |
| Mot de passe oublié | `/compte/mot-de-passe-oublie/` |

Sessions sécurisées (HttpOnly, SameSite). Limitation de débit sur login / inscription.

Pour le mot de passe oublié en production, configurez SMTP dans `.env` (voir `.env.example`). En développement, le lien s'affiche dans la console Django.

## Base de données Neon (Postgres)

1. Créer un projet sur [neon.com](https://neon.com)
2. Copier l'URL de connexion Postgres
3. Dans `.env` :

```env
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

Sans `DATABASE_URL`, SQLite est utilisé (`db.sqlite3`).

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Application : http://localhost:8000/

## Tests

```bash
source .venv/bin/activate
python manage.py test routing
```

Les tests utilisent SQLite en mémoire (indépendamment de `DATABASE_URL`).

### Tests E2E (Playwright)

```bash
source .venv/bin/activate
python manage.py migrate
python manage.py runserver &
cd e2e && npm install && npm test
```

CI : GitHub Actions (`.github/workflows/ci.yml`) — tests unitaires + Playwright.

## Structure

```
graphicage-ter-app/
├── config/                 # Settings Django
├── routing/                # App principale (API, auth, OR-Tools)
│   ├── services/           # solver, distance, places, geocoding, osrm
│   ├── auth_views.py       # Comptes + historique
│   └── models.py           # CatalogPoint, SavedScenario, RouteHistory
├── templates/
│   ├── landing.html        # Page d'accueil
│   ├── account/            # Connexion, inscription…
│   └── routing/index.html  # Application carte
├── static/routing/         # CSS, JS, favicon
├── data/                   # Dataset exemple
├── e2e/                    # Tests Playwright
├── documentation/          # Doc HTML
├── Dockerfile
└── docker-compose.yml
```

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `DJANGO_SECRET_KEY` | Clé secrète (obligatoire en prod) |
| `DJANGO_DEBUG` | `True` / `False` |
| `DJANGO_ALLOWED_HOSTS` | Hôtes autorisés (virgules) |
| `DATABASE_URL` | Postgres Neon (optionnel) |
| `OSRM_BASE_URL` | Serveur OSRM (défaut : public) |
| `GOOGLE_API_KEY` | Géocodage Google (optionnel) |
| `USE_GOOGLE_DISTANCE_MATRIX` | Alternative à OSRM (prévu) |
| `EMAIL_*` | SMTP pour mot de passe oublié (prod) |
| `DEFAULT_FROM_EMAIL` | Expéditeur des e-mails |

## Stack

| Composant | Technologie |
|-----------|-------------|
| Backend | Django 5, Django REST Framework |
| Base de données | SQLite ou Neon Postgres |
| Optimisation | Google OR-Tools |
| Frontend | HTML, CSS, JavaScript vanilla, Leaflet, Lucide Icons |
| Distances | Haversine ou OSRM (réseau routier) |
| Auth | Sessions Django, validateurs mot de passe |
| CI | GitHub Actions |

## Documentation

- [Documentation HTML](http://localhost:8000/documentation/) — guide complet
- [Migration depuis GraphicageTER](documentation/migration.html)

## Origine

Projet migré depuis `GraphicageTER/Test_serveur_python/` et `GraphicageTER/exemple/`.

## Licence

Travaux de recherche — usage éducatif.
