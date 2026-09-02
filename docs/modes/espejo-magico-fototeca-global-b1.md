# Espejo Magico: refinamiento B.1, fototeca global

## Objetivo y estado

Estado: `COMPLETADA`.

Nota: la taxonomia de tipos de B.1 fue reemplazada por [`espejo-magico-taxonomia-b2.md`](./espejo-magico-taxonomia-b2.md).

B.1 convierte la biblioteca de recursos en un catalogo global ViralCo visible para todas las cuentas, sin crear vinculos previos. Los favoritos siguen siendo compartidos por cuenta y el configurador conserva acceso tanto a recursos globales como propios.

## Contrato de consulta

`GET /api/accounts/:accountId/library` acepta `scope`:

- `linked` (predeterminado): conserva el comportamiento anterior y devuelve las filas de `account_library` de la cuenta.
- `global`: devuelve assets ViralCo activos y superpone el favorito de la cuenta mediante una union opcional.
- `available`: devuelve globales activos y assets propios activos; es el alcance del configurador.

Se mantienen `favorite`, `type`, `category`, `q`, `page` y `pageSize`. La respuesta conserva `{ library, pagination }`. `libraryAssetId` siempre identifica el asset; `id` es `null` cuando un global aun no tiene fila en `account_library`.

El catalogo global se ordena por creacion descendente e ID como desempate. Al filtrar favoritos, se ordena por `favoritedAt` descendente e ID. Los assets inactivos nunca se exponen.

## Favoritos

`PATCH /api/accounts/:accountId/library/:libraryAssetId/favorite` valida que el asset este activo y sea global o pertenezca a la cuenta. Marcar un global por primera vez crea o actualiza mediante upsert su fila de `account_library`, incluyendo `favoritedAt` y `favoritedBy`. Desmarcar solo cambia el favorito; no elimina el asset ni sus asociaciones.

`library.view` permite consultar. `library.manage` permite modificar favoritos a owner, administrador y Super Admin. El operador conserva lectura de catalogo y favoritos.

## Importador y previews

El importador idempotente de Espejo Magico:

- conserva las variantes `thumb`, `card` y `full` de imagenes;
- genera posters WebP `thumb` y `card` para videos mediante FFmpeg empaquetado;
- repara variantes faltantes aunque el original ya exista;
- no vuelve a subir binarios completos ni crea posters/demo como assets independientes;
- publica recursos como globales sin requerir `MAGIC_MIRROR_ACCOUNT_ID`.

Tras cada prueba de integracion se debe resolver el usuario canonico `superadmin@viralco.local` y reimportar desde `/private/tmp/Prueba-viralco`, porque la integracion ejecuta reseed.

## Evidencia de cierre

- Scopes `linked`, `global` y `available`, aislamiento por cuenta, permisos, filtros, orden y paginacion cubiertos por integracion.
- Upsert y retiro de favorito global cubiertos sin romper el contrato legado.
- 19 assets canonicos disponibles globalmente.
- 27 variantes de imagen y 20 posters de video verificados.
- Segunda ejecucion idempotente con 19 omisiones y cero fallos.
