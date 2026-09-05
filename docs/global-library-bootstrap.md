# Restauracion del catalogo global

R2 es el almacenamiento durable de los binarios globales. La base de datos contiene el indice consultable por la aplicacion y puede reconstruirse usando los manifiestos versionados del repositorio.

## Reset estandar

Ejecutar:

```bash
npm run db:reset
```

El comando, en este orden:

1. revierte todas las migraciones;
2. aplica las migraciones vigentes;
3. ejecuta los seeds;
4. garantiza el Super Admin y la cuenta `viralco_platform`;
5. restaura el catalogo global desde R2;
6. crea o repara las plantillas globales de layout.

Las pruebas de integracion ejecutan el mismo bootstrap despues de su reseed.

## Variables

Son obligatorias las variables R2 normales: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` y `R2_BUCKET_PATH`.

- `BOOTSTRAP_SUPER_ADMIN_EMAIL`: identidad canonica; por defecto `superadmin@viralco.local`.
- `GLOBAL_LIBRARY_CREATED_BY`: ID alternativo del Super Admin creador. Es opcional.
- `GLOBAL_LIBRARY_ASSET_ROOT`: raiz local de `Prueba-viralco`. Es opcional y solo se exige si falta en R2 un original procedente del prototipo.

No se define una cuenta destino: los recursos `owner_type=viralco` son globales y visibles dinamicamente para todas las cuentas.

## Operacion idempotente

`npm run db:bootstrap-global-library` puede ejecutarse en cualquier momento. Busca cada recurso por `metadata.manifestId`, conserva IDs y favoritos existentes, repone filas y variantes faltantes y no vuelve a subir objetos completos. El estado esperado actual es de 38 recursos: 32 medios y 6 plantillas configurables.

Un reset completo elimina favoritos y asociaciones pertenecientes a cuentas, porque son datos transaccionales de la base. No elimina los objetos globales de R2 y el catalogo ViralCo vuelve a quedar disponible automaticamente.
