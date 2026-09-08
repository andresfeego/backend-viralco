# B.3 — Plantillas de diseño fotográfico

Estado: `COMPLETADA`.

## Contrato

Las plantillas son recursos inmutables `library_assets.type=template` con MIME `application/vnd.kaptura.photo-layout+json`. El JSON original se almacena en R2 y su contrato consultable en `library_asset_templates`.

`PhotoLayoutTemplateV1` contiene exclusivamente:

- `schemaVersion: 1` y `kind: mirror-photo-layout`.
- Formato base y dimensiones de salida.
- Cantidad de tomas, orden de captura y slots porcentuales. `photoNumber` referencia la toma y `slotId` identifica cada instancia visual, por lo que una toma puede aparecer varias veces sin generar una captura adicional.
- Indicador de tira duplicada.

No incluye marcos, fondos, stickers, textos, captura, experiencia, entrega ni runtime. Al aplicarla se reemplaza solamente la geometría del borrador y se preserva el resto de `MirrorConfigV1`.

## Preview fiel

`thumb` (160 × 160) y `card` (512 × 512) se generan desde el mismo JSON canónico mediante SVG y Sharp. El lienzo conserva la relación de aspecto real; cada slot respeta posición y tamaño porcentual y muestra el número correspondiente a su orden de captura, incluidas las repeticiones de una misma toma. El hash SHA-256 identifica el contenido y `preview_renderer_version` permite regenerar variantes futuras.

## API

- `POST /api/admin/library/layout-templates`: crea plantilla global; solo Super Admin.
- `POST /api/accounts/:accountId/library/layout-templates`: crea plantilla privada; owner, administrador o Super Admin.
- `GET /api/accounts/:accountId/library/:libraryAssetId/layout-template`: consulta el contrato.
- `POST /api/events/:eventId/modes/:eventModeId/layout-templates/:assetId/apply`: compatibilidad para clientes anteriores; copia la geometría y guarda con `expectedRevision`, sin crear un `event_resource`.

Los uploads de archivos continúan rechazando `template`: una plantilla solo nace del editor visual y no de una imagen.
Las nuevas plantillas globales o de cuenta deben usar `baseFormat=personalizar-5x15` y salida `2000 × 2960`; la lectura de recursos históricos con otras dimensiones continúa disponible.

## Recursos iniciales

Los seis diseños —Digital, Dos fotos, Recuerdo, Tira, Postal y Collage— son globales, universales para tipos de evento y tienen JSON y dos previews en R2. Todos utilizan el lienzo portrait canónico de 10 × 14,8 cm, representado como `2000 × 2960` y `baseFormat=personalizar-5x15`. `Personalizado` se mantiene como entrada especial del editor.

El importador `npm run assets:import:photo-layout-templates` usa `metadata.manifestId` y rutas R2 deterministas. Cuando cambia el JSON canónico actualiza el objeto, hash y previews existentes; la segunda ejecución no duplica recursos. También forma parte de `npm run db:bootstrap-global-library`.

Las plantillas creadas por una cuenta se enlazan inmediatamente a `account_library` como favoritas. La configuración visual mantiene `schemaVersion: 1` y admite adicionalmente:

- `layout.stickerLayers`: máximo diez capas con `resourceId`, posición, tamaño, rotación y orden. El recurso asociado debe ser `sticker/static`.
- `layout.textLayers[].fontResourceId`: fuente de biblioteca independiente para cada capa; `resources.fontResourceId` continúa como respaldo histórico.

La validación y el manifiesto de publicación incluyen los IDs de marcos, fondos, stickers y fuentes usados en tiempo de ejecución, pero nunca el ID del preset de plantilla. La composición respeta el orden fondo, tomas, marco, stickers y textos.

Una plantilla es únicamente un preset. El cliente actual consulta su JSON, copia formato, dimensiones, tomas, orden, slots, rotaciones y tira duplicada al borrador local, y no guarda ni crea un `event_resource`. `layout.presetOrigin` conserva como metadata informativa el ID del asset, nombre, origen Global/Favoritos y hash; no se valida como recurso ni entra al manifiesto de lanzamiento.

La primera modificación manual limpia `presetOrigin` sin alterar la geometría y muestra el diseño como personalizado. Un borrador histórico con `resources.layoutTemplateResourceId` conserva sus slots y, en el siguiente guardado, el backend limpia la referencia y desactiva su antigua asociación. `FRAME_REQUIRED` fue eliminado: un layout estructuralmente válido publica sin plantilla ni marco. Las publicaciones históricas permanecen sin cambios.

## Compatibilidad

`resources.templateResourceId` continúa representando plantillas-imagen históricas de publicaciones inmutables. `resources.layoutTemplateResourceId` es solo una referencia heredada que se desacopla al guardar. El borrador y las nuevas publicaciones consumen directamente la geometría copiada, por lo que eliminar o desactivar el preset original no invalida el evento.
