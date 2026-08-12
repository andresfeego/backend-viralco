# Comportamiento del Modelo ViralCo

Este documento complementa `viralco.dbml`. El DBML define estructura, llaves y relaciones; este archivo define reglas de negocio que deben respetarse al crear migraciones, servicios, seeds y pantallas.

## Fuente de verdad

- `WEB/backend/docs/database/viralco.dbml` es la fuente tecnica del modelo de datos.
- `diagrama uml final.png` es la representacion visual aprobada del DBML.
- Este documento conserva reglas de comportamiento que no deben meterse como notas largas en el diagrama.
- Si el DBML cambia, el diagrama y este documento deben revisarse juntos.

## Identidad, cuentas y roles

- `users` representa identidad personal, no cliente ni empresa.
- Un usuario puede pertenecer a varias cuentas mediante `account_users`.
- Un usuario puede tener roles diferentes en cuentas diferentes.
- `user_roles` queda reservado para roles globales de plataforma, principalmente `super_admin`.
- Los roles de cuenta viven en `account_users.role_id`.
- Un usuario puede ser `owner` de varias cuentas.
- Una cuenta debe tener al menos una membresia activa con rol `owner`.
- No se debe permitir eliminar, suspender o degradar al unico `owner` activo de una cuenta.

## Suscripciones

- La suscripcion siempre pertenece a `accounts` mediante `subscriptions.account_id`.
- La suscripcion nunca debe colgar de `users`.
- Cambios de propietario no transfieren suscripciones, porque la suscripcion pertenece a la cuenta.
- Los limites del plan se leen desde `subscription_plans.limits` y/o desde la suscripcion vigente.
- Un usuario con varias cuentas puede operar cada cuenta bajo la suscripcion correspondiente de esa cuenta.

## Eventos

- Todo evento pertenece obligatoriamente a una cuenta mediante `events.account_id`.
- Los usuarios con membresia activa en la cuenta pueden leer eventos segun permisos de cuenta.
- `owner` y `admin` pueden crear y editar eventos de su cuenta.
- `operario` y `cliente` no deben crear ni editar eventos salvo que se agregue un permiso explicito posterior.
- `super_admin` puede operar cualquier cuenta usando contexto explicito de `accountId`.
- `event_users` asigna usuarios concretos a eventos cuando se necesite limitar operacion o visibilidad a nivel evento.
- La membresia de cuenta no reemplaza `event_users`; define acceso general a la cuenta. `event_users` define asignacion especifica al evento.

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
- `event_branding.logo_resource_id` y `event_branding.background_resource_id` apuntan a `event_resources`, no a URLs manuales.
- `asset_event_resources` registra que recursos de configuracion se aplicaron a un asset final capturado o renderizado.

## R2 y almacenamiento

- R2 es privado.
- El backend genera keys canonicas y URLs firmadas.
- El cliente no debe enviar URLs externas arbitrarias como fuente de verdad.
- Los recursos globales deben guardarse bajo un prefijo administrado por ViralCo.
- Los recursos de cuenta deben guardarse bajo un prefijo de cuenta.
- Los recursos usados por evento referencian `library_assets`; no necesitan duplicar archivo por evento.

## Reglas para pasar de diseno a migraciones

- Antes de crear migraciones, comparar `viralco.dbml` contra las migraciones actuales.
- Si falta una decision de comportamiento, preguntar antes de asumir.
- No generar columnas derivadas de notas visuales; las decisiones deben estar en DBML o en este documento.
- Los IDs `bigint` se exponen por API como strings.
- Las reglas de permisos deben probarse en backend, no depender solo de UI.
