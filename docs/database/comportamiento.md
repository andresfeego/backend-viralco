# Comportamiento del Modelo ViralCo

Este documento complementa `viralco.dbml`. El DBML define estructura, llaves y relaciones; este archivo define reglas de negocio que deben respetarse al crear migraciones, servicios, seeds y pantallas.

## Fuente de verdad

- `WEB/backend/docs/database/viralco.dbml` es la fuente tecnica del modelo de datos.
- `diagrama uml final.png` es la representacion visual aprobada del DBML.
- Este documento conserva reglas de comportamiento que no deben meterse como notas largas en el diagrama.
- Si el DBML cambia, el diagrama y este documento deben revisarse juntos.

## Identidad, cuentas y roles

- `users` representa identidad personal, no cliente ni empresa.
- Un usuario puede ser propietario de varias cuentas mediante `account_users`.
- Los colaboradores se asignan a eventos, no a cuentas; pueden tener roles diferentes en cada evento.
- `user_roles` queda reservado para roles globales de plataforma, principalmente `super_admin`.
- `account_users.role_id` conserva solamente propietarios; las altas y cambios de colaboradores de cuenta estan retirados (HTTP 410).
- Un usuario puede ser `owner` de varias cuentas.
- Una cuenta debe tener al menos una membresia activa con rol `owner`.
- No se debe permitir eliminar, suspender o degradar al unico `owner` activo de una cuenta.
- La migracion `20261006120000_event_memberships.cjs` retira membresias no propietarias y conserva una copia en `retired_account_memberships`. No elimina perfiles, eventos, capturas ni propietarios, y no adjudica automaticamente los antiguos miembros a eventos. La restauracion de permisos requiere una decision explicita; no hay rollback automatico.

## Suscripciones

- La suscripcion siempre pertenece a `accounts` mediante `subscriptions.account_id`.
- La suscripcion nunca debe colgar de `users`.
- Cambios de propietario no transfieren suscripciones, porque la suscripcion pertenece a la cuenta.
- Los limites del plan se leen desde `subscription_plans.limits` y/o desde la suscripcion vigente.
- Un usuario con varias cuentas puede operar cada cuenta bajo la suscripcion correspondiente de esa cuenta.

### Contratacion y comprobantes de transferencia

- Crear una cuenta guarda `billing_contracts` (servicios, 30 o 365 dias y tarifas COP) y su primer `billing_orders` pendiente en la misma transaccion. La pantalla de pagos no cambia esa contratacion ni exige escoger banco; muestra los datos bancarios activos como informacion.
- Enviar un comprobante del importe exacto fija el periodo: comienza al enviarlo o al terminar el ultimo periodo pagado, lo que ocurra despues. Verificar el pago no cambia esas fechas.
- El primer envio concede hasta 72 horas de acceso provisional, sin superar ese limite al reenviar un comprobante rechazado. Rechazar retira ese acceso inmediatamente en el servidor, sin anular periodos pagados anteriores.
- El acceso provisional firmado para trabajar offline tiene el mismo vencimiento. Sin conexion, el dispositivo solo conoce un rechazo al reconectar. A diferencia de un periodo pagado, una autorizacion provisional no concede continuidad de lanzamiento despues de su vencimiento.
- Las ordenes, comprobantes y revisiones conservan el historial; aprobar dos veces el mismo reporte no genera dos periodos. Los comprobantes siguen en R2 privado.
- Adjuntar comprobante exige importe y fecha, pero no numero de transferencia. `reference` acepta un valor vacio por compatibilidad; los valores historicos se conservan. Dos referencias vacias no constituyen duplicado; la comprobacion de archivos repetidos sigue activa. La referencia bancaria de la verificacion del superadmin no cambia.
- `billing_reviews.observations` guarda notas opcionales del superadmin (hasta 2000 caracteres), independientes de `reason`, tanto al aprobar como al rechazar. Se consultan solo en el historial de Cobros del superadmin y no se editan tras resolver el reporte. La migracion `20261006130000_billing_review_observations.cjs` agrega la columna sin alterar pagos, periodos ni comprobantes existentes.

### Renovacion diaria y avisos

- El backend ejecuta `startBillingRenewalSchedule` cada dia a las **09:00, America/Bogota** (14:00 UTC), independientemente de la zona horaria del servidor. No es un temporizador por cuenta ni una tarea de Codex.
- Cinco dias calendario colombianos antes del vencimiento pagado se crea un recibo pendiente con el contrato guardado y un aviso dentro de Suscripcion y pagos. Solo hay un recibo abierto por cuenta y una renovacion por periodo concedido; las cuentas impagadas no acumulan recibos sucesivos.
- `billing_daily_runs` registra cada ejecucion en base de datos. El bloqueo transaccional y las claves unicas evitan duplicados entre procesos. Al arrancar el backend se recupera la ultima ejecucion debida si faltaba; el siguiente disparo vuelve a ser a las 09:00.
- El servidor debe permanecer disponible para ejecutar a la hora prevista. Si esta apagado, la recuperacion sucede al arrancar. Los avisos push quedan pendientes; no se requieren credenciales APNs/FCM en esta entrega.
- Los modos archivados o no disponibles para contratar no generan renovaciones nuevas. Los recibos anteriores y periodos pagados conservan sus condiciones.
- La comprobacion de vigencia sigue haciendose en cada operacion. El proceso existente de proyeccion de estados cada minuto es independiente: no genera recibos ni avisos.
- La migracion `20261006100000_billing_contract_renewals.cjs` es aditiva: conserva historial y adopta la ultima contratacion registrada (o preferencias antiguas con tarifas validas). No ejecuta reset ni seeds.
- `20261006110000_billing_pending_report_dates.cjs` adopta los reportes antiguos pendientes desde su fecha original de envio, sin conceder otras 72 horas ni tocar periodos aprobados. Solo el importe exacto habilita acceso provisional.

## Eventos

- Todo evento pertenece obligatoriamente a una cuenta mediante `events.account_id`.
- El propietario y superadmin pueden crear eventos. El propietario conserva acceso a los eventos de su cuenta.
- En `event_users`, `admin` puede editar/configurar el evento, gestionar sus miembros y operarlo; `operario` puede consultarlo y operarlo; `cliente` solo puede consultarlo. Ninguno de estos roles adjudica acceso a otras cuentas, pagos ni eventos no asignados.
- `super_admin` puede operar cualquier cuenta usando contexto explicito de `accountId`.
- `event_users` usa correo normalizado para resolver un perfil existente y activo. Un correo desconocido recibe `EVENT_MEMBER_REGISTER_FIRST`; no se crea usuario ni invitacion. No se permite cambiar o retirar la asignacion propia desde el editor de miembros.
- `event_users.status` permite suspender una asignacion sin borrar el perfil. Retirar una asignacion no borra sus capturas.
- `/api/events/accounts` incluye cuentas propietarias y un contexto minimo de las cuentas con eventos asignados. El listado de eventos y cada endpoint validan la asignacion activa con `assertEventAccess`.
- El administrador del evento accede a recursos por `/api/events/:id/library`; el servidor deriva la cuenta del evento. Los recursos y favoritos siguen perteneciendo a la biblioteca compartida de esa cuenta, sin conceder administracion de la cuenta.
- Los permisos offline firmados pasan a version 3 y el catalogo local a version 2. Se requiere una primera conexion para actualizar autorizaciones anteriores. Al reconectar se revalida el permiso del evento antes de sincronizar; una revocacion no borra fotos locales. No es posible revocar instantaneamente dispositivos que sigan desconectados con una version anterior.

## Biblioteca de recursos

- `library_assets` es la tabla unica de recursos reutilizables.
- `library_assets.owner_type = 'viralco'` representa biblioteca global gestionada por ViralCo.
- `library_assets.owner_type = 'account'` representa recursos propios o clones personalizados de una cuenta.
- Cuando `owner_type = 'viralco'`, `owner_account_id` debe ser `null`.
- Cuando `owner_type = 'account'`, `owner_account_id` debe apuntar a la cuenta propietaria.
- `source_asset_id` apunta al recurso original cuando un asset de cuenta nace como clon de un recurso global.
- Los archivos no se duplican al agregar un recurso global a una cuenta.
- La duplicacion fisica/logica ocurre solo cuando la cuenta personaliza el recurso; en ese caso se crea un nuevo `library_assets` con owner de cuenta.

## Biblioteca de cuenta

- `account_library` define que recursos forman parte de la coleccion privada de una cuenta.
- Una cuenta puede agregar un recurso global a su biblioteca sin clonar archivo.
- Una cuenta puede agregar recursos propios creados por ella misma.
- `UNIQUE(account_id, library_asset_id)` evita duplicar el mismo recurso dentro de la biblioteca de la cuenta.
- La biblioteca de cuenta es la base desde donde se seleccionan recursos para eventos.

## Recursos usados por evento

- `event_resources` define que recursos consume un evento.
- `event_resources` no debe guardar URLs arbitrarias ni archivos duplicados.
- Cada `event_resources.library_asset_id` apunta a un `library_assets` disponible para el evento.
- `purpose` define el uso del recurso: `frame`, `overlay`, `intro`, `outro`, `music`, `logo`, `background`, `template`, `branding` u otro valor aprobado.
- `placement`, `config` y `order_index` definen comportamiento visual u orden de aplicacion.
- `event_branding.logo_resource_id` apunta a `event_resources`, no a una URL manual. El evento no mantiene un background visual propio; los fondos pertenecen a la configuracion de cada modo.
- `asset_event_resources` registra que recursos de configuracion se aplicaron a un asset final capturado o renderizado.

## R2 y almacenamiento

- R2 es privado.
- El backend genera keys canonicas y URLs firmadas.
- El cliente no debe enviar URLs externas arbitrarias como fuente de verdad.
- Los recursos globales deben guardarse bajo un prefijo administrado por ViralCo.
- Los recursos de cuenta deben guardarse bajo un prefijo de cuenta.
- Los recursos usados por evento referencian `library_assets`; no necesitan duplicar archivo por evento.

## Eliminacion y conservacion de historial

- `DELETE /api/events/:id` requiere `events.delete`. Owner, administrador y Super Admin pueden ejecutarlo.
- Un evento sin publicaciones ni sesiones se elimina definitivamente junto con sus relaciones dependientes.
- Un evento con publicaciones o sesiones se conserva y cambia a `archived`.
- `DELETE /api/accounts/:accountId` requiere `accounts.delete`, disponible para owner y Super Admin, y exige `confirmationName` igual al nombre exacto de la cuenta.
- Las cuentas `is_system=true`, incluida `viralco_platform`, nunca pueden eliminarse.
- Una cuenta sin historial se elimina definitivamente. Sus eventos sin historial, membresias, suscripciones, favoritos y assets privados se eliminan; los objetos R2 de esos assets se limpian despues de confirmar la transaccion.
- Una cuenta con publicaciones o sesiones cambia a `canceled`; sus eventos pasan a `archived` y su historial se conserva.
- Los assets globales ViralCo y sus objetos R2 nunca se eliminan como consecuencia de borrar una cuenta.
- Las sesiones, experiencias, tomas y entregables de Espejo son historial operativo. Las eliminaciones de cuenta o evento deben conservarlos y archivar la entidad propietaria.

## Reglas para pasar de diseno a migraciones

- Antes de crear migraciones, comparar `viralco.dbml` contra las migraciones actuales.
- Si falta una decision de comportamiento, preguntar antes de asumir.
- No generar columnas derivadas de notas visuales; las decisiones deben estar en DBML o en este documento.
- Los IDs `bigint` se exponen por API como strings.
- Las reglas de permisos deben probarse en backend, no depender solo de UI.
