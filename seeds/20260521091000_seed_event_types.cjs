const MODES = [
  { slug: 'foto', name: 'Foto', description: 'Captura fotografica base', is_default: true },
  { slug: 'video-360', name: 'Video 360', description: 'Video 360 para plataforma giratoria', is_default: false },
  { slug: 'videoblog', name: 'Videoblog', description: 'Grabacion tipo mensaje o videoblog', is_default: false },
];

const EVENT_TYPES = [
  { slug: 'boda', name: 'Boda', description: 'Evento social de boda', sort_order: 10 },
  { slug: 'cumpleanos', name: 'Cumpleanos', description: 'Celebracion de cumpleanos', sort_order: 20 },
  { slug: 'bautizo', name: 'Bautizo', description: 'Evento social de bautizo', sort_order: 30 },
  { slug: 'quince-anos', name: '15 anos', description: 'Celebracion de quince anos', sort_order: 40 },
  { slug: 'grado', name: 'Grado', description: 'Ceremonia o fiesta de grado', sort_order: 50 },
  { slug: 'baby-shower', name: 'Baby shower', description: 'Celebracion de baby shower', sort_order: 60 },
  { slug: 'corporativo', name: 'Corporativo', description: 'Evento corporativo o empresarial', sort_order: 70 },
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
  {
    slug: 'business',
    name: 'Business',
    description: 'Plan ficticio para validar cuentas con mayor volumen',
    limits: JSON.stringify({ events: 100, storageGb: 1000, devices: 25 }),
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
  for (const eventType of EVENT_TYPES) await knex('event_types').insert({ ...eventType, is_active: true }).onConflict('slug').merge();
  for (const plan of PLANS) await knex('subscription_plans').insert(plan).onConflict('slug').merge();
  for (const category of CATEGORIES) await knex('library_asset_categories').insert({ ...category, is_active: true }).onConflict('slug').merge();
};
