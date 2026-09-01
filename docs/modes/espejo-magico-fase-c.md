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

Los slots usan porcentajes y deben permanecer dentro del lienzo. Cada toma aparece exactamente una vez en `layout.order` y en `layout.slots`. `digital-vertical` se conserva como alias compatible para publicaciones anteriores.

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

