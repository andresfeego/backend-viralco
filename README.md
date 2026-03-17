# backend-viralco

Backend de la aplicacion Viralco con Express, Drizzle y MySQL.

## Requisitos

- Node `20.19.4`
- pnpm `10.7.0`

## Variables de entorno

Copiar `.env.example` a `.env` y completar:

- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `R2_BUCKET_PATH`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_REGION`
- `R2_ACCOUNT_ID`

## Scripts

- `pnpm dev`: servidor en desarrollo
- `pnpm build`: compila a `dist/server.js`
- `pnpm start`: ejecuta el build
