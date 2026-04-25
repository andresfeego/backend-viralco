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

## MariaDB local (Docker)

Se incluye `docker-compose.mariadb.yml` para levantar MariaDB local en puerto `3307`.

- `npm run db:local:up`: levanta MariaDB local
- `npm run db:local:down`: apaga contenedor local
- `npm run db:local:logs`: logs en vivo de MariaDB local
- `npm run db:local:migrate`: aplica migraciones contra MariaDB local
- `npm run db:local:reset`: reinicia DB local desde cero (borra volumen)

### Flujo recomendado local (proyecto desde cero)

1. `npm run db:local:up`
2. `npm run db:local:migrate`
3. correr API con tus vars de entorno (`npm run dev`)

### Orden recomendado en deploy

1. `npm run db:migrate`
2. `npm run db:seed` (solo si existen seeds para ese entorno)
3. `npm run start`

Los seeds usan sintaxis compatible con MariaDB para evitar el problema de `INSERT ... VALUES (...) AS new_alias`.
