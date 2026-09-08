# Perfiles de impresion de Espejo Magico

## Alcance

La configuracion de impresion se modela como un recurso estructurado `print_profile`. El recurso describe una combinacion reutilizable de impresora, papel y valores de salida; no guarda la direccion, credenciales ni el estado de una impresora fisica.

La deteccion del equipo ocurre exclusivamente en el dispositivo. La aplicacion asocia localmente la impresora elegida con la cuenta y utiliza el perfil favorito correspondiente para completar la configuracion del evento. El envio real del trabajo a la impresora permanece fuera de este alcance.

## Contrato `PrintProfileV1`

- `schemaVersion: 1` y `kind: print-profile`.
- Fabricante y modelo.
- Papel: nombre, ancho y alto en milimetros, orientacion, impresion sin bordes y margen seguro.
- Salida: DPI, ajuste `contain|cover`, copias predeterminadas y maximas, impresion doble y modo de color.
- Compatibilidad: transportes y plataformas.

El JSON original se almacena en R2 con MIME `application/vnd.kaptura.print-profile+json`; `library_asset_templates` conserva la representacion consultable e inmutable y `library_asset_variants` contiene miniaturas WebP.

## API y permisos

- `POST /api/admin/library/print-profiles`: crea un perfil global; requiere Super Admin.
- `POST /api/accounts/:accountId/library/print-profiles`: crea un perfil de cuenta y lo marca favorito; requiere `library.manage`.
- `GET /api/accounts/:accountId/library/:libraryAssetId/print-profile`: consulta un perfil disponible; requiere `library.view`.

El listado existente admite `type=print_profile`. La asociacion al evento usa `event_resources` con `purpose=print_profile`, y `MirrorConfigV1.print.profileResourceId` siempre referencia ese recurso del evento.

## Perfil inicial y restauracion

`resources/print-profiles.json` incluye Canon SELPHY CP1500, papel Postal de 100 x 148 mm, 300 DPI y AirPrint. `db:bootstrap-global-library` crea o repara el perfil y sus previews despues de resets y reseeds, buscando por `metadata.manifestId` para conservar la idempotencia.

## Configuracion por evento

Seleccionar un perfil carga sus valores recomendados, pero durante esta iteracion ancho, alto, margen, copias, DPI, orientacion, ajuste e impresion doble permanecen editables en el borrador del evento. La publicacion valida rangos y exige un perfil activo cuando la impresion esta habilitada.
