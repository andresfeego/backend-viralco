require('dotenv/config');

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const knexFactory = require('knex');
const knexConfig = require('../knexfile.cjs');
const manifest = require('../resources/magic-mirror-assets.json');
const layoutTemplates = require('../resources/photo-layout-templates.json');
const printProfiles = require('../resources/print-profiles.json');

const root = path.resolve(__dirname, '..');
const environment = {
  ...process.env,
  BOOTSTRAP_SUPER_ADMIN_EMAIL: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'superadmin@viralco.local',
};

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function main() {
  runNode([path.join(root, 'scripts/import-magic-mirror-assets.cjs')]);
  runNode([require.resolve('tsx/cli'), path.join(root, 'scripts/import-photo-layout-templates.ts')]);
  runNode([require.resolve('tsx/cli'), path.join(root, 'scripts/import-print-profiles.ts')]);

  const db = knexFactory(knexConfig[process.env.NODE_ENV === 'production' ? 'production' : 'development']);
  try {
    const [{ count: assetCount }] = await db('library_assets').where({ owner_type: 'viralco', status: 'active' }).count({ count: '*' });
    const [{ count: manifestCount }] = await db('library_assets')
      .where({ owner_type: 'viralco', status: 'active' })
      .whereRaw("JSON_EXTRACT(metadata, '$.manifestId') IS NOT NULL")
      .count({ count: '*' });
    const expectedMinimum = manifest.length + layoutTemplates.length + printProfiles.length;
    if (Number(assetCount) < expectedMinimum || Number(manifestCount) < expectedMinimum) {
      throw new Error(`Catalogo global incompleto: ${assetCount} activos, se esperaban al menos ${expectedMinimum}`);
    }
    console.log(`Catalogo global listo: ${assetCount} recursos activos (${manifest.length} medios + ${layoutTemplates.length} plantillas + ${printProfiles.length} perfiles de impresion)`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
