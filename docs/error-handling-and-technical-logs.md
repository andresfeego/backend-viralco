# Errores seguros y logs tecnicos

## Contrato de respuesta

Todas las excepciones capturadas por controladores usan `sendApiError`. Los errores esperados de dominio (`ServiceError`) conservan un mensaje util y su estado HTTP. Las excepciones inesperadas, incluidas fallas de base de datos, almacenamiento o librerias, responden con un mensaje generico de la operacion y HTTP 500.

La respuesta contiene:

- `error`: mensaje publico o codigo funcional seguro.
- `code`: `REQUEST_REJECTED`, un codigo funcional estructurado o `INTERNAL_ERROR`.
- `requestId`: identificador de correlacion generado por peticion.
- `details`: solo para errores funcionales estructurados, como validacion o conflicto de revision.

Nunca se devuelven consultas, parametros SQL, stack traces, rutas locales, tokens ni mensajes de drivers. El mismo `requestId` se envia en el header `x-request-id`.

## Registro tecnico

Los errores se registran en dos destinos:

1. `bitacora`: conserva accion, estado HTTP, codigo, `requestId` y detalle tecnico. Es consultable por Super Admin desde `Superadmin > Bitacora`.
2. Archivo JSONL de contingencia: `.runtime-logs/backend-errors.jsonl`. Siempre recibe las excepciones capturadas y también cubre el caso en que MariaDB no esta disponible. La ruta puede cambiarse con `TECHNICAL_LOG_DIRECTORY`.

El archivo de contingencia no se versiona, se crea con permisos restringidos y aplica redaccion de tokens y encabezados de autorizacion. Los payloads de auditoria mantienen la redaccion existente de contrasenas y tokens.

## Clasificacion

- Error esperado: validacion, permisos, conflicto o recurso inexistente. Puede mostrar su mensaje funcional.
- Error inesperado: SQL, red, R2, driver, excepcion de programacion o dependencia. El cliente recibe un mensaje generico y el detalle queda solo en logs.
- Error de escritura de bitacora: se registra en el archivo de contingencia como `AUDIT_LOG_WRITE_FAILED`.

## Verificacion manual

Buscar por `requestId` en la bitacora y comparar `errorCode` y `errorDetalle`. Para una caida de base de datos, revisar el mismo identificador en el archivo JSONL después de restaurar el servicio.
