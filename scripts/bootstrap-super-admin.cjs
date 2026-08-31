require('dotenv/config');
const bcrypt = require('bcryptjs');
const knexFactory = require('knex');
const config = require('../knexfile.cjs');
const { ensurePlatformAccount, PLATFORM_ACCOUNT_SLUG } = require('./platform-account.cjs');

const email = String(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || '');
const name = String(process.env.BOOTSTRAP_SUPER_ADMIN_NAME || '').trim();

if (!email.includes('@') || password.length < 12 || !name) {
  throw new Error('Define BOOTSTRAP_SUPER_ADMIN_EMAIL, BOOTSTRAP_SUPER_ADMIN_PASSWORD (min 12) y BOOTSTRAP_SUPER_ADMIN_NAME');
}

const knex = knexFactory(config[process.env.NODE_ENV === 'production' ? 'production' : 'development']);

async function main() {
  await knex.transaction(async (trx) => {
    const status = await trx('user_statuses').where({ slug: 'active' }).first();
    const role = await trx('roles').where({ slug: 'super_admin' }).first();
    if (!status || !role) throw new Error('Ejecuta npm run db:seed antes del bootstrap');

    const passwordHash = await bcrypt.hash(password, 12);
    await trx('users').insert({
      email, password: passwordHash, name, phone: null, status_id: status.id,
      theme_mode: 'dark', created_at: trx.fn.now(), updated_at: trx.fn.now(),
    }).onConflict('email').merge({ password: passwordHash, name, status_id: status.id, updated_at: trx.fn.now() });

    const user = await trx('users').where({ email }).first();
    await trx('user_roles').insert({ user_id: user.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
    await ensurePlatformAccount(trx, user.id);
  });
  console.log(`Super admin listo: ${email}; cuenta de plataforma: ${PLATFORM_ACCOUNT_SLUG}`);
}

main().finally(() => knex.destroy());
