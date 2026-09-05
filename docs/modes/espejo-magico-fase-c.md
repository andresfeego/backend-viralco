# Espejo magico: fase C

## Objetivo

La fase C implementa el configurador visual de Espejo Magico sobre el contrato `MirrorConfigV1`. El borrador se edita por cuenta, evento y modo; se guarda con revision optimista, se valida y se publica como una version inmutable. El lanzamiento operativo pertenece a la fase D.

## Formatos

| Formato | Tomas | Salida |
| --- | ---: | ---: |
| `digital` | 1 | 1200 x 1500 |
| `doble` | 2 | 1200 x 1500 |
| `recuerdo` | 3 | 1200 x 1800 |
| `tira` | 3 | 600 x 1800 |
| `personalizar-5x15` | 1-8 | 2000 x 2960 |
| `postal` | 1 | 1800 x 1200 |
| `collage` | 4 | 1600 x 1200 |

Los slots usan porcentajes y deben permanecer dentro del lienzo. Cada toma aparece exactamente una vez en `layout.order` y al menos una vez en `layout.slots`. Se admiten hasta 8 tomas y 16 slots visuales: `photoNumber` identifica la captura y puede repetirse, mientras `slotId` identifica de forma unica cada posicion visual. Esto permite mostrar una misma foto varias veces con geometria, rotacion y capa independientes. Las configuraciones historicas sin `slotId` siguen siendo validas y se normalizan al editarse. `digital-vertical` se conserva como alias compatible para publicaciones anteriores.

Cada slot puede incluir `rotation`, expresada en grados entre `-180` y `180`. El campo ausente en configuraciones historicas equivale a `0`. La rotacion forma parte tanto del borrador y la publicacion inmutable como del recurso `mirror-photo-layout`; el generador de miniaturas aplica el mismo giro alrededor del centro de la toma.

Los marcos editables se guardan en `layout.frameLayers`. Cada capa contiene `id`, `resourceId`, geometria porcentual, rotacion y `order`; se admiten hasta 10 capas y un mismo `event_resource` puede aparecer varias veces. El orden solo altera la profundidad dentro del grupo de marcos, que se compone despues de las tomas y antes de stickers y textos. `resources.frameResourceId` se conserva para lectura de configuraciones historicas y el editor lo normaliza a una capa sin modificar publicaciones inmutables existentes.

Los fondos editables se guardan en `layout.backgroundLayers`, con maximo 10 elementos. Cada capa contiene `id`, `kind` (`resource` o `color`), `resourceId` o `color` hexadecimal, geometria porcentual, rotacion y `order`. Solo las capas `resource` participan en el manifiesto y deben resolver un `event_resource` de proposito `background`; las capas `color` permanecen dentro del JSON. El grupo completo se compone antes de las tomas y su orden no afecta otras familias de capas. Un fondo puede desbordar el lienzo si conserva al menos 10% de su area dentro del recorte. Los fondos de color admiten hasta 200% de ancho y alto; los fondos de imagen permanecen limitados a 100%. `resources.backgroundResourceId` se mantiene para lectura historica y la aplicacion lo normaliza al editar.

Los stickers editables se guardan en `layout.stickerLayers`, con maximo 10 elementos. Cada capa tiene `id` unico, `resourceId`, geometria porcentual, rotacion y `order` unico. Varias capas pueden reutilizar el mismo `event_resource` estatico; el orden solo altera la profundidad dentro del grupo de stickers, compuesto despues de marcos y antes de textos. Los stickers pueden desbordar el lienzo con la misma regla de conservar al menos 10% de su area visible. Los slots de foto y marcos continuan completamente acotados al lienzo.

Las capas de texto admitidas son `script`, `name`, `event` y `date`. Cada capa guarda texto, posicion, ancho, tamano, color y una fuente integrada o la referencia logica `resource`; en ese caso el archivo se resuelve exclusivamente mediante `resources.fontResourceId`.

## Recursos y animaciones

La configuracion conserva IDs de `event_resources`, nunca URLs ni keys. Plantilla, marco, fondo, fuente y pantalla inicial usan sus campos dedicados. Las animaciones usan `resources.animationResourceIds`; su etapa vive en `event_resources.placement` y puede ser `beforeCountdown`, `afterCapture`, `countdown`, `pickMusic`, `beforeSignature`, `processing`, `afterProcessing` o `sessionEnd`.

`experience.randomByStage` solo acepta esas etapas y activa seleccion aleatoria cuando hay varios recursos asociados a la misma etapa. La pantalla inicial usa `startScreenResourceId`.

## Captura y experiencia

El contrato admite cuenta regresiva inicial y entre tomas, revision, flash, lente `normal`, `wide` o `ultra-wide`, calidad `medium`, `high` o `superior`, originales y modo itinerante. Los estilos de experiencia son `video-vertical`, `minimal` y `party`.

Entrega admite QR, compartir y descargar. Runtime admite reinicio automatico y menu del operador. GIF real, eliminacion de fondo e impresion fisica permanecen deshabilitados. La base de impresion se mantiene en 10 x 14,8 cm, retrato, 300 DPI, una copia y ajuste `contain`.

## API, permisos y conflicto

Se mantienen los endpoints de configuracion definidos en las fases A y B. Consultar requiere `events.view`; guardar, validar y publicar requiere `events.update`; asociar recursos requiere ademas `events.resources.manage`.

Owner, administrador y Super Admin pueden editar. Un operador consume la publicacion activa en modo lectura. `expectedRevision` sigue siendo obligatorio; un desfase responde HTTP 409 con `CONFIG_REVISION_CONFLICT` y nunca sobrescribe silenciosamente.

## Criterio de cierre

- Los siete formatos, slots, textos, recursos, captura, experiencia, entrega y runtime se configuran sin IDs o URLs manuales.
- El preview mobile usa exactamente el objeto que se envia a la API.
- Guardar, validar, recuperar un conflicto y publicar funcionan con permisos reales.
- Pruebas backend y mobile, lint, temas e i18n quedan verdes.

## Estado final

Fase `COMPLETA`. El contrato fue implementado sin migraciones ni endpoints nuevos. La publicacion resultante queda disponible para el preflight y lanzamiento operativo de la fase D.
