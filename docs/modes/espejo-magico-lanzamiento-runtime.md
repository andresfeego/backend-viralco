# Espejo Mágico — lanzamiento, captura y entrega local-first

## Alcance

Esta iteración conecta una publicación inmutable de `MirrorConfigV1` con la operación real en Kaptura. Una `event_mode_session` representa el lanzamiento prolongado de un modo durante el evento. Dentro de ella pueden existir muchas `mirror_capture_runs`, una por invitado o experiencia. Nunca se crea una sesión nueva por cada fotografía.

La cámara, las tomas y el entregable se conservan primero en el dispositivo. La red se utiliza para coordinar la exclusión entre equipos y sincronizar archivos, pero una pérdida de conectividad posterior al preflight no invalida la captura local.

## Exclusión e idempotencia

- Solo puede existir una sesión `preparing` o `running` por `event_mode`.
- El inicio bloquea la fila del modo dentro de una transacción para serializar intentos concurrentes.
- `client_session_id`, `client_run_id`, `client_capture_id` y `client_asset_id` hacen idempotentes los reintentos.
- Un owner, administrador o Super Admin puede finalizar forzosamente una sesión abandonada; el operador no puede tomar ese control administrativo.
- La sesión siempre queda fijada a la versión publicada que existía al iniciarla.

## Persistencia

- `mirror_capture_runs`: experiencia individual dentro del lanzamiento.
- `mirror_captures`: cada toma e intento, con número, hash SHA-256 y estado de sincronización.
- `assets`: entregable compuesto; su `public_hash` nace antes de subir el binario.
- `asset_event_resources`: trazabilidad de recursos aplicados al entregable.
- `deliveries`: solicitudes QR, compartir y descarga.

Los objetos de R2 se escriben en:

`accounts/{accountId}/events/{eventId}/mirror/{sessionId}/{captures|deliverables}/{clientId}.{ext}`

El backend entrega un PUT firmado que exige `Content-Type` y `x-amz-meta-sha256`. La confirmación realiza `HEAD` en R2 y compara tamaño y hash antes de marcar el registro como sincronizado. Las URLs firmadas de lectura se generan bajo demanda y nunca se persisten como fuente de verdad.

## API

- `GET .../sessions/active`: recuperar la sesión exclusiva.
- `POST .../sessions`: preparar un lanzamiento idempotente.
- `PATCH .../sessions/:sessionId`: heartbeat y transición a `running`.
- `POST .../sessions/:sessionId/end`: finalizar normalmente o con fallo.
- `POST .../sessions/:sessionId/force-end`: toma de control administrativa.
- `GET .../sessions/:sessionId/package`: configuración fijada y manifiesto con URLs frescas.
- `POST .../sessions/:sessionId/runs`: registrar una experiencia.
- `PATCH .../runs/:runId`: actualizar su estado.
- `POST .../runs/:runId/captures` y `.../:captureId/complete`: preparar y confirmar una toma.
- `POST .../runs/:runId/assets` y `.../:assetId/complete`: crear temprano y confirmar el entregable.
- `GET /api/public/assets/:publicHash`: registrar el método indicado (`qr` o `download`) y redirigir al objeto sincronizado sin autenticación.
- `POST /api/public/assets/:publicHash/deliveries`: registrar el canal de entrega.

## Reglas y límites actuales

- El evento debe estar activo, el modo contratado y la configuración publicada.
- JPEG y PNG son los formatos de captura/entregable; límite de 50 MB por archivo.
- QR solo aparece después de sincronizar porque apunta a la copia del servidor.
- Compartir y guardar el archivo local no requieren que R2 haya terminado.
- Impresión física, GIF real y eliminación de fondo permanecen fuera de este runtime.
- El borrado local automático de originales se pospone hasta contar con verificación operativa prolongada; la preferencia `preserveOriginals` queda registrada sin arriesgar recuperabilidad.

## Verificación

- Build backend y 49 pruebas unitarias verdes.
- 16 pruebas de integración verdes con exclusión de sesión, idempotencia de runs/assets y reseed posterior.
- Rollback y reaplicación de la migración runtime verificados.
- Migración aplicada sobre la base de desarrollo y catálogo global restaurado a 40 recursos.
