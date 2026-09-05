# backend-viralco

Backend de la aplicacion Viralco con Express, Drizzle y MariaDB.

## Requisitos

- Node `24.15.0` (LTS)
- npm

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_CHARSET` (default recomendado: `utf8mb4`)
- `R2_BUCKET_PATH`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_REGION`
- `R2_ACCOUNT_ID`

## Scripts API

- `npm run dev`: servidor en desarrollo
- `npm run build`: compila a `dist/server.js`
- `npm run start`: ejecuta el build

## Migraciones y Seeds (Knex + MariaDB)

- `npm run db:migrate`: aplica migraciones
- `npm run db:rollback`: revierte la ultima migracion
- `npm run db:seed`: ejecuta seeds
- `npm run db:bootstrap-super-admin`: crea o actualiza el Super Admin usando variables `BOOTSTRAP_SUPER_ADMIN_*`
- `npm test`: ejecuta pruebas unitarias
- `npm run test:integration`: ejecuta pruebas contra una DB migrada con `RUN_DB_TESTS=1`

La fuente tecnica del esquema es `docs/database/viralco.dbml`. El reset de esta version no conserva datos del esquema anterior.

## MariaDB local (Docker)

Se incluye `docker-compose.mariadb.yml` para levantar MariaDB local en puerto `3307`.

- `npm run db:local:up`: levanta MariaDB local
- `npm run db:local:down`: apaga contenedor local
- `npm run db:local:logs`: logs en vivo de MariaDB local
- `npm run db:local:migrate`: aplica migraciones contra MariaDB local
- `npm run db:reset`: reconstruye la DB configurada y ejecuta migrations, seeds, cuenta de plataforma y catálogo global.
- `npm run db:bootstrap-global-library`: restaura idempotentemente el catálogo global desde R2 y el manifiesto versionado.
- `npm run db:local:reset:volume`: solo recrea el volumen MariaDB; después debe ejecutarse `npm run db:reset` cuando el servidor vuelva a aceptar conexiones.

### Flujo recomendado local (proyecto desde cero)

1. `npm run db:local:up`
2. `npm run db:local:migrate`
3. `npm run db:seed`
4. configurar `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD` y `BOOTSTRAP_SUPER_ADMIN_NAME`
5. `npm run db:bootstrap-super-admin`
6. `npm run db:bootstrap-platform-account`
7. `npm run db:bootstrap-global-library`
8. correr API con tus vars de entorno (`npm run dev`)

`GLOBAL_LIBRARY_ASSET_ROOT` es opcional durante un reset normal: si los objetos ya existen en R2, las filas y variantes se reconstruyen sin el repositorio del prototipo. Solo se exige esa ruta si falta en R2 alguno de los 19 recursos provenientes de `Prueba-viralco`.

El procedimiento operativo completo esta en [`docs/global-library-bootstrap.md`](./docs/global-library-bootstrap.md).

### Orden recomendado en deploy

1. `npm run db:migrate`
2. `npm run db:seed` (solo si existen seeds para ese entorno)
3. `npm run start`

Los seeds usan sintaxis compatible con MariaDB para evitar el problema de `INSERT ... VALUES (...) AS new_alias`.
