const MODES = [
  { slug: 'foto', name: 'Foto', description: 'Captura fotografica base', is_default: true },
  { slug: 'video-360', name: 'Video 360', description: 'Video 360 para plataforma giratoria', is_default: false },
  { slug: 'videoblog', name: 'Videoblog', description: 'Grabacion tipo mensaje o videoblog', is_default: false },
];

const PLANS = [
  {
    slug: 'starter',
    name: 'Starter',
    description: 'Plan base para cuentas en desarrollo',
    limits: JSON.stringify({ events: 3, storageGb: 25, devices: 2 }),
    is_active: true,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Plan operativo para eventos comerciales',
    limits: JSON.stringify({ events: 25, storageGb: 250, devices: 10 }),
    is_active: true,
  },
];

const CATEGORIES = [
  { slug: 'frames', name: 'Frames', description: 'Marcos y plantillas visuales' },
  { slug: 'overlays', name: 'Overlays', description: 'Capas graficas sobre capturas' },
  { slug: 'branding', name: 'Branding', description: 'Logos, fondos y piezas de marca' },
  { slug: 'music', name: 'Musica', description: 'Recursos de audio' },
  { slug: 'templates', name: 'Templates', description: 'Plantillas reutilizables' },
];

/** @param {import('knex').Knex} knex */
exports.seed = async function seed(knex) {
  for (const mode of MODES) await knex('modes').insert(mode).onConflict('slug').merge();
  for (const plan of PLANS) await knex('subscription_plans').insert(plan).onConflict('slug').merge();
  for (const category of CATEGORIES) await knex('library_asset_categories').insert({ ...category, is_active: true }).onConflict('slug').merge();
};
