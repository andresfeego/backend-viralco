# Espejo magico: fases A y B

> Este documento contiene el detalle técnico de A y B. El estado transversal A–H vive en [`espejo-magico-plan-maestro.md`](./espejo-magico-plan-maestro.md).

## Objetivo

Esta especificacion define el contrato backend para configurar, publicar y lanzar localmente el modo `espejo`, y para seleccionar sus recursos desde la biblioteca de la cuenta. La captura, composicion, GIF final, eliminacion de fondo e impresion fisica pertenecen a fases posteriores.

## Decisiones de producto

- El lanzamiento inicial ocurre en el mismo dispositivo que ejecuta la app.
- La configuracion se guarda como borrador y se publica explicitamente como una version inmutable.
- Los favoritos de biblioteca se comparten por cuenta.
- La configuracion solo guarda IDs de `event_resources`; nunca URLs ni archivos locales.

## Fase A: configuracion y sesiones

`event_mode_configs` conserva un borrador por `event_modes.id`, con `schema_version`, `revision`, JSON validado y la version publicada activa. `event_mode_config_versions` conserva publicaciones inmutables. `event_mode_sessions` referencia siempre una publicacion y usa `client_session_id` para inicio idempotente.

`MirrorConfigV1` contiene `layout`, `resources`, `capture`, `experience`, `gif`, `backgroundRemoval`, `print`, `delivery` y `runtime`. GIF y eliminacion de fondo permanecen deshabilitados mientras el runtime no anuncie esas capacidades.

Endpoints:

- `GET|PUT /api/events/:eventId/modes/:eventModeId/config`
- `POST /api/events/:eventId/modes/:eventModeId/config/validate`
- `POST /api/events/:eventId/modes/:eventModeId/config/publish`
- `GET /api/events/:eventId/modes/:eventModeId/config/published`
- `POST /api/events/:eventId/modes/:eventModeId/sessions`
- `PATCH /api/events/:eventId/modes/:eventModeId/sessions/:sessionId`
- `POST /api/events/:eventId/modes/:eventModeId/sessions/:sessionId/end`

Permisos: `events.view` para consultar, `events.update` para guardar/publicar y `capture.operate` para operar sesiones. La asociacion de recursos conserva `events.resources.manage`.

## Fase B: biblioteca y favoritos

`account_library` incorpora favorito compartido, actor y fecha. El listado acepta `favorite`, `category`, `type`, `q`, `page` y `pageSize`. Cambiar favorito requiere `library.manage`; consultarlo requiere `library.view`.

Se admiten los propositos `start_screen`, `animation`, `gif_overlay` y `font`, ademas de los existentes. Imagenes y fuentes tienen limite de 25 MB; videos, 100 MB. El importador de recursos aprobados es idempotente y excluye contenido demo no productivo.

## Invariantes

- Una publicacion no se modifica.
- Una sesion no usa un borrador.
- `expectedRevision` evita sobrescrituras; el conflicto responde `CONFIG_REVISION_CONFLICT` con HTTP 409.
- Un recurso de modo pertenece al mismo evento y, si es especifico, al mismo `event_mode`.
- Todos los IDs bigint salen de la API como strings.

## Estado implementado

- El borrador optimista, las publicaciones inmutables y las sesiones idempotentes estan activos en los endpoints documentados.
- La publicacion valida orden y slots, formato de impresion, suscripcion, cuenta, evento, modo, proposito y familia MIME de cada recurso.
- El manifiesto de lanzamiento resuelve el asset y sus variantes; la configuracion publicada conserva solo IDs.
- La bitacora HTTP existente registra guardados, publicaciones, inicios, heartbeats exitosos o fallidos y cierres sin exponer secretos.
- El importador `assets:import:magic-mirror` usa un manifiesto versionado, hashes y keys deterministas. Puede reconstruir el indice completo desde los objetos que ya existen en R2; `GLOBAL_LIBRARY_ASSET_ROOT` solo es necesario para reparar un original del prototipo que falte en R2.
- `db:bootstrap-global-library` repone idempotentemente medios, variantes, tipos de evento y plantillas globales. El Super Admin canonico se resuelve mediante `BOOTSTRAP_SUPER_ADMIN_EMAIL` si no se especifica `GLOBAL_LIBRARY_CREATED_BY`.
- `assets:check:magic-mirror` valida previamente el manifiesto y sus fuentes sin escribir en R2 ni en base de datos.
- La cuenta protegida `viralco_platform` se crea de forma idempotente junto al Super Admin canonico. Los assets globales conservan `owner_type=viralco` y `owner_account_id=null`; la cuenta representa a la plataforma, no limita el alcance global.
- Los recursos canonicos pueden enlazarse al pool de `viralco_platform` mediante `MAGIC_MIRROR_ACCOUNT_ID` sin duplicar archivos ni cambiar su propiedad global.
