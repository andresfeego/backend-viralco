# Espejo Magico: refinamiento B.2, taxonomia de recursos

Estado: `COMPLETADA`.

## Contrato

La fototeca clasifica los recursos activos con `background`, `frame`, `sticker`, `template`, `animation` y `font`. `template` queda reservado para una futura configuracion de diseno y no admite altas basadas solamente en imagenes. `start_screen` deja de ser un tipo nuevo; los valores historicos continúan siendo legibles en configuraciones publicadas.

Los stickers usan `motionType=static|animated`: PNG para estaticos y GIF para animados. Ningun otro tipo acepta `motionType`.

`appliesToAllEventTypes=true` identifica recursos universales. Cuando es `false`, `library_asset_event_types` debe contener uno o varios tipos activos. Esta relacion solo filtra el descubrimiento: no bloquea la asociacion del recurso a otro evento.

## API

`GET /api/accounts/:accountId/library` conserva `scope`, favoritos, busqueda y paginacion, y añade:

- `eventType=<slug>`: exclusivamente recursos relacionados de forma explicita con ese tipo. Los universales permanecen visibles en `Todos`.
- `motion=static|animated`: stickers del movimiento elegido.

Cada asset devuelve `motionType`, `appliesToAllEventTypes` y `eventTypes`. Las altas aceptan `appliesToAllEventTypes` y `eventTypeIds`; si se omiten, el recurso es universal.

## Migracion e importacion

- `gif_overlay` se convierte a `sticker/animated`.
- overlays decorativos pasan a `sticker`, infiriendo movimiento por MIME.
- Los seis `template-*` importados pasan a `frame` sin cambiar ID, original, variantes ni favoritos.
- `template-boda` se relaciona con Boda y `template-cumple` con Cumpleanos; los demas recursos son universales.
- La deteccion por `metadata.manifestId` conserva la idempotencia aunque cambie el tipo y la ruta canonica futura.

El catalogo incluye diez TTF Regular de Google Fonts con commit y SHA-256 fijados, metadata de autor/OFL y licencia almacenada. `fontkit` valida el archivo y `sharp` genera `thumb` y `card` WebP con el texto real `Tu evento`. El mismo helper procesa futuras fuentes creadas por API.

## Evidencia

- Rollback y reaplicacion de la migracion verificados.
- Build, unitarias e integracion verdes; la integracion ejecuto su reseed.
- Primera importacion: 29 importados, cero fallos.
- Segunda importacion: 29 omitidos, cero reparaciones y cero fallos.
- Base de datos: 29 assets globales, 67 variantes y 10 previews de fuente.
- R2: presentes los 106 objetos referenciados por originales, variantes y licencias.
