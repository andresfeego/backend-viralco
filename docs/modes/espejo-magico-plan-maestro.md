# Espejo Magico: plan maestro de fases

## Proposito

Este documento es la fuente de verdad para la entrega progresiva del modo `espejo`. Define alcance, dependencias, estado y criterio de cierre de las fases A–H. Los detalles técnicos ya implementados de A y B permanecen en [`espejo-magico-fases-a-b.md`](./espejo-magico-fases-a-b.md).

Ultima actualizacion: 2026-09-01.

## Estados

- `COMPLETADA`: alcance implementado, probado, documentado y publicado en la rama de trabajo.
- `EN_PROGRESO`: existe una parte operativa, pero faltan entregables obligatorios para cerrar la fase.
- `PENDIENTE`: no se ha iniciado su implementación de producto.
- `PAUSADA`: el trabajo se detiene deliberadamente hasta cerrar una dependencia prioritaria.
- `FUERA_DE_ALCANCE_ACTUAL`: decisión explícita de no incluirla en la iteración vigente.

## Resumen ejecutivo

| Fase | Nombre | Estado | Siguiente acción |
| --- | --- | --- | --- |
| A | Contrato, configuración y sesiones backend | `COMPLETADA` | Consumir el contrato desde el configurador móvil |
| B | Pool, favoritos y recursos | `COMPLETADA` | Reutilizar `ResourcePicker` dentro de la fase C |
| B.1 | Fototeca global ViralCo | `COMPLETADA` | Consumir el alcance `available` desde el configurador |
| C | Configurador visual de Espejo | `COMPLETA` | Entregar su publicación al lanzamiento operativo |
| D | Preparación y lanzamiento operativo | `PAUSADA` | Retomar preflight, caché y control de sesión después de B.1 |
| E | Runtime de captura Espejo | `PENDIENTE` | Implementar cámara y secuencia de tomas después de D |
| F | Composición y entregable | `PENDIENTE` | Implementar render final y pipeline del asset |
| G | Entrega al invitado | `PENDIENTE` | Integrar QR, descarga, compartir y página pública |
| H | Capacidades avanzadas | `FUERA_DE_ALCANCE_ACTUAL` | Retomar después de estabilizar A–G |

## Fase A — Contrato, configuración y sesiones backend

Estado: `COMPLETADA`.

### Alcance

- Contrato versionado `MirrorConfigV1`.
- Borrador único y mutable por modo de evento.
- Control de concurrencia mediante `expectedRevision`.
- Validación local, de recursos, permisos y suscripción.
- Publicaciones numeradas e inmutables.
- Snapshot publicado para ejecución.
- Sesiones idempotentes mediante `clientSessionId` UUID.
- Estados `preparing`, `running`, `ended` y `failed`.
- Heartbeat, cierre, fallo y metadata operativa.
- Bitácora de operaciones HTTP.

### Evidencia de cierre

- Migraciones `event_mode_configs`, `event_mode_config_versions` y `event_mode_sessions`.
- API de configuración, validación, publicación y sesiones.
- Pruebas de defaults, revisión, publicación, recursos, suscripción, idempotencia y transiciones.
- Rollback y reaplicación de migraciones verificados.

## Fase B — Pool, favoritos y recursos

Estado: `COMPLETADA`.

### Alcance

- Biblioteca global de ViralCo y pool por cuenta.
- Favoritos compartidos.
- Búsqueda, filtros y paginación.
- Nuevos propósitos, MIME y límites de carga.
- Asociación mediante `event_resources`.
- Selector móvil reutilizable y estados de interfaz.
- Subida con progreso y validación de compatibilidad.
- Actualización de `MirrorConfigV1` y rollback ante conflicto.
- Importador idempotente y modo `dry-run`.
- Cuenta protegida `viralco_platform`.

### Evidencia de cierre

- 19 assets canónicos importados: 6 plantillas, 3 marcos y 10 animaciones.
- 47 variantes de preview y 66 objetos verificados en R2.
- Los 19 assets se publican como globales de ViralCo; B.1 elimina la necesidad de enlazarlos previamente a cada cuenta.
- Segunda importación verificada con 19 omisiones y cero fallos.
- Componentes `ResourceLibraryScreen`, `ResourcePicker`, `ResourceCard`, `ResourceFilters`, `ResourceUploadAction` y `ResourceSelectionSummary`.

## Refinamiento B.1 — Fototeca global ViralCo

Estado: `COMPLETADA`.

El contrato y la evidencia detallada viven en [`espejo-magico-fototeca-global-b1.md`](./espejo-magico-fototeca-global-b1.md).

### Alcance

- Catalogo global visible sin crear previamente `account_library`.
- Scopes compatibles `linked`, `global` y `available`.
- Favoritos compartidos por cuenta mediante upsert.
- Posters WebP de videos globales y reparacion idempotente de variantes.
- Fototeca mobile densa con Global/Favoritos, filtros, busqueda, preview y paginacion incremental.
- Configurador sin cambios visuales y consumiendo `scope=available`.

## Fase C — Configurador visual de Espejo

Estado: `COMPLETA`.

El contrato de implementacion vive en [`espejo-magico-fase-c.md`](./espejo-magico-fase-c.md).

### Alcance

- Flujo mobile de configuración por cuenta, evento y modo.
- Formato, dimensiones, número de tomas y orden.
- Editor visual de slots porcentuales.
- Tira duplicada y capas de texto.
- Plantilla, marco, fondo, fuente, pantalla inicial y animaciones.
- Tiempos de captura y revisión.
- Flash, lente, calidad, originales y modo itinerante.
- Configuración de experiencia, entrega y runtime del operador.
- Preview de composición en claro y oscuro.
- Guardar, validar y publicar.
- Estados dirty, saving, saved, invalid, conflict y published.
- Recuperación explícita ante `CONFIG_REVISION_CONFLICT`.

### Criterio de cierre

- Un owner/admin configura y publica sin ingresar IDs, URLs o keys manuales.
- Un operador puede consultar la versión publicada, pero no editarla.
- El preview refleja el mismo contrato enviado al backend.
- Pruebas de validación, permisos, conflictos, restauración, temas e i18n verdes.

### Evidencia de cierre

- `MirrorConfigV1` valida los siete formatos productivos y conserva el alias legado `digital-vertical`.
- Geometria, textos, captura, experiencia, entrega, runtime y etapas de animacion tienen validacion versionada.
- El configurador mobile guarda, restaura, valida, resuelve conflictos y publica revisiones inmutables.
- Owner, administrador y Super Admin editan; operador consume exclusivamente la publicacion activa.
- Build backend, 21 pruebas unitarias, 10 pruebas de integracion con reseed, 45 pruebas mobile, lint y bundle iOS verificados.

### Dependencias

- Requiere A y B.

## Fase D — Preparación y lanzamiento operativo

Estado: `PAUSADA`.

La infraestructura backend de sesiones está completa; la experiencia mobile todavía está pendiente.
La experiencia de lanzamiento consumira la publicacion producida por el configurador de la fase C.

### Alcance pendiente

- Home operativo con evento activo y modos disponibles.
- Selección de la publicación que se ejecutará.
- Preflight de cámara, permisos, almacenamiento, red y recursos.
- Descarga, verificación y caché local del manifiesto.
- Identificador persistente de instalación.
- Creación idempotente de sesión.
- Transición `preparing` a `running`.
- Heartbeats y detección de pérdida de conexión.
- Reintento, recuperación después de reinicio y prevención de doble lanzamiento.
- Menú del operador y cierre `ended` o `failed`.

### Criterio de cierre

- Un operador puede lanzar una publicación válida desde un dispositivo real.
- La sesión se recupera después de reiniciar la app sin duplicarse.
- Ninguna sesión inicia con recursos faltantes o configuración no publicada.
- Heartbeats, cierre y fallos quedan registrados.

### Dependencias

- Requiere A.
- Debe integrarse con el resultado de C.

## Fase E — Runtime de captura Espejo

Estado: `PENDIENTE`.

### Alcance

- Pantalla inicial y acción de comenzar.
- Asistente y animaciones por etapa.
- Cuenta regresiva inicial y entre tomas.
- Cámara, lente y flash.
- Captura de una a ocho fotografías.
- Revisión y repetición individual.
- Modo itinerante.
- Conservación opcional de originales.
- Manejo de permisos, interrupciones y errores de cámara.

### Criterio de cierre

- La secuencia completa utiliza exclusivamente la publicación asociada a la sesión.
- Las tomas sobreviven a interrupciones recuperables.
- Cámara y navegación se validan en dispositivos iOS y Android soportados.

### Dependencias

- Requiere C y D.

## Fase F — Composición y entregable

Estado: `PENDIENTE`.

### Alcance

- Aplicación de fotografías a slots.
- Plantilla, marco, fondo y textos.
- Duplicación de tira cuando corresponda.
- Render final con dimensiones y calidad publicadas.
- Creación temprana del registro entregable.
- Estados de procesamiento y recuperación.
- Subida a R2 y asociación con evento, modo y sesión.
- Conservación o descarte controlado de originales.

### Criterio de cierre

- El resultado es determinista para una versión publicada y las mismas tomas.
- El asset final queda disponible mediante el pipeline de media sin rutas locales ni URLs hardcodeadas.
- Fallos parciales pueden reintentarse sin duplicar entregables.

### Dependencias

- Requiere E y el pipeline de media del proyecto.

## Fase G — Entrega al invitado

Estado: `PENDIENTE`.

### Alcance

- QR y enlace público.
- Descarga y compartir.
- Página pública del entregable.
- Integración con galería del evento.
- Estado de procesamiento visible para el invitado.
- Cola y reintento cuando no exista conexión.

### Criterio de cierre

- El invitado recibe el entregable sin autenticación administrativa.
- El enlace existe antes de finalizar el procesamiento y refleja sus cambios de estado.
- La entrega no bloquea el reinicio operativo para el siguiente invitado.

### Dependencias

- Requiere F y la infraestructura pública de entrega.

## Fase H — Capacidades avanzadas

Estado: `FUERA_DE_ALCANCE_ACTUAL`.

### Alcance futuro

- GIF real.
- Eliminación de fondo.
- Impresión física y detección de impresoras.
- Perfiles de papel, copias y calibración.
- Métricas avanzadas, telemetría y diagnóstico remoto.
- Capacidades adicionales anunciadas por el runtime.

### Regla de activación

Una capacidad solo puede habilitarse en `MirrorConfigV1` cuando backend, dispositivo, pruebas y operación real la soporten. Hasta entonces la publicación debe rechazarla.

### Dependencias

- Requiere estabilización de A–G.

## Orden aprobado de trabajo

1. Mantener B.1 y C estabilizadas.
2. Retomar y completar D en mobile y dispositivos reales.
3. Implementar E.
4. Implementar F.
5. Implementar G.
6. Evaluar y priorizar H por capacidad.

## Regla de actualización

Al cerrar una fase se debe actualizar este documento en el mismo commit o bloque de entrega, incluyendo evidencia de pruebas, limitaciones conocidas y siguiente dependencia desbloqueada.
