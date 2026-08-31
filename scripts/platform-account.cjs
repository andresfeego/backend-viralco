const PLATFORM_ACCOUNT_SLUG = String(process.env.BOOTSTRAP_PLATFORM_ACCOUNT_SLUG || 'viralco_platform').trim().toLowerCase();
const PLATFORM_ACCOUNT_NAME = String(process.env.BOOTSTRAP_PLATFORM_ACCOUNT_NAME || 'ViralCo Platform').trim();

async function ensurePlatformAccount(trx, ownerUserId) {
  const ownerRole = await trx('roles').where({ slug: 'owner' }).first();
  if (!ownerRole) throw new Error('Rol owner no inicializado');
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(PLATFORM_ACCOUNT_SLUG)) throw new Error('BOOTSTRAP_PLATFORM_ACCOUNT_SLUG invalido');
  if (!PLATFORM_ACCOUNT_NAME) throw new Error('BOOTSTRAP_PLATFORM_ACCOUNT_NAME requerido');

  const now = trx.fn.now();
  await trx('accounts').insert({
    slug: PLATFORM_ACCOUNT_SLUG,
    name: PLATFORM_ACCOUNT_NAME,
    owner_user_id: ownerUserId,
    status: 'active',
    is_system: true,
    created_at: now,
    updated_at: now,
  }).onConflict('slug').merge({
    name: PLATFORM_ACCOUNT_NAME,
    owner_user_id: ownerUserId,
    status: 'active',
    is_system: true,
    updated_at: now,
  });

  const account = await trx('accounts').where({ slug: PLATFORM_ACCOUNT_SLUG }).first();
  await trx('account_users').insert({
    account_id: account.id,
    user_id: ownerUserId,
    role_id: ownerRole.id,
    status: 'active',
    invited_by: ownerUserId,
    invited_at: now,
    joined_at: now,
    created_at: now,
    updated_at: now,
  }).onConflict(['account_id', 'user_id']).merge({ role_id: ownerRole.id, status: 'active', updated_at: now });

  return account;
}

module.exports = { ensurePlatformAccount, PLATFORM_ACCOUNT_NAME, PLATFORM_ACCOUNT_SLUG };
