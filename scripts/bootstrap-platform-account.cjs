require('dotenv/config');
const knexFactory = require('knex');
const config = require('../knexfile.cjs');
const { ensurePlatformAccount, PLATFORM_ACCOUNT_SLUG } = require('./platform-account.cjs');

const email = String(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
if (!email.includes('@')) throw new Error('Define BOOTSTRAP_SUPER_ADMIN_EMAIL con el Super Admin canonico');

const knex = knexFactory(config[process.env.NODE_ENV === 'production' ? 'production' : 'development']);

async function main() {
  await knex.transaction(async (trx) => {
    const user = await trx('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'u.email': email, 'r.slug': 'super_admin' })
      .select('u.id')
      .first();
    if (!user) throw new Error('El usuario indicado no existe o no tiene rol super_admin');
    await ensurePlatformAccount(trx, user.id);
  });
  console.log(`Cuenta de plataforma lista: ${PLATFORM_ACCOUNT_SLUG}`);
}

main().finally(() => knex.destroy());
