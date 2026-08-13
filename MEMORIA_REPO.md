# MEMORIA_REPO - WEB/backend

## Regla clave
- Para despliegue local usar:
  1. `nvm use`
  2. `npm start`
- En desarrollo también se permite `npm run dev`.
- Para pruebas manuales, levantar backend en terminal interactiva (no `nohup` en segundo plano) para asegurar persistencia del proceso.
- Regla de runtime: después de cualquier prueba de integración que toque la DB local debe correrse `npm run db:seed` antes de validar login en mobile. El script `npm run test:integration` ya lo ejecuta automáticamente aunque el test falle.
