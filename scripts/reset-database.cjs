require('dotenv/config');

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const knexFactory = require('knex');
const knexConfig = require('../knexfile.cjs');

const root = path.resolve(__dirname, '..');
const selectedConfig = knexConfig[process.env.NODE_ENV === 'production' ? 'production' : 'development'];
const environment = {
  ...process.env,
  SEED_DEMO_USERS: process.env.SEED_DEMO_USERS || 'true',
  BOOTSTRAP_SUPER_ADMIN_EMAIL: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'superadmin@viralco.local',
};

function runNode(script) {
  const result = spawnSync(process.execPath, [script], { cwd: root, env: environment, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Fallo ${path.basename(script)}`);
}

async function main() {
  const db = knexFactory(selectedConfig);
  try {
    await db.migrate.rollback(undefined, true);
    await db.migrate.latest();
    await db.seed.run();
  } finally {
    await db.destroy();
  }
  runNode(path.join(root, 'scripts/bootstrap-platform-account.cjs'));
  runNode(path.join(root, 'scripts/bootstrap-global-library.cjs'));
  console.log('Reset completo: migrations, seeds, cuenta de plataforma y catalogo global');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
