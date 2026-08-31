const MODES = [
  { slug: 'espejo', name: 'Espejo', description: 'Experiencia tipo espejo para captura fotografica', price_amount: 50, price_currency: 'USD', is_default: true },
  { slug: 'cabina', name: 'Cabina', description: 'Experiencia de cabina fotografica', price_amount: 60, price_currency: 'USD', is_default: false },
  { slug: 'video-360', name: 'Video 360', description: 'Video 360 para plataforma giratoria', price_amount: 80, price_currency: 'USD', is_default: false },
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
    slug: 'suscripcion',
    name: 'Suscripcion',
    description: 'Suscripcion base; el valor aumenta segun los servicios contratados',
    limits: JSON.stringify({ events: 100, storageGb: 250, devices: 10 }),
    is_active: true,
  },
];

const CATEGORIES = [
  { slug: 'frames', name: 'Frames', description: 'Marcos y plantillas visuales' },
  { slug: 'overlays', name: 'Overlays', description: 'Capas graficas sobre capturas' },
  { slug: 'branding', name: 'Branding', description: 'Logos, fondos y piezas de marca' },
  { slug: 'music', name: 'Musica', description: 'Recursos de audio' },
  { slug: 'templates', name: 'Templates', description: 'Plantillas reutilizables' },
  { slug: 'animations', name: 'Animaciones', description: 'Videos y secuencias de experiencia' },
  { slug: 'gifs', name: 'GIFs', description: 'Overlays y recursos animados' },
  { slug: 'fonts', name: 'Fuentes', description: 'Tipografias reutilizables' },
];

/** @param {import('knex').Knex} knex */
exports.seed = async function seed(knex) {
  for (const mode of MODES) await knex('modes').insert(mode).onConflict('slug').merge();
  for (const eventType of EVENT_TYPES) await knex('event_types').insert({ ...eventType, is_active: true }).onConflict('slug').merge();
  for (const plan of PLANS) await knex('subscription_plans').insert(plan).onConflict('slug').merge();
  for (const category of CATEGORIES) await knex('library_asset_categories').insert({ ...category, is_active: true }).onConflict('slug').merge();

  const [subscriptionPlan] = await knex('subscription_plans').where({ slug: 'suscripcion' }).select('id').limit(1);
  if (subscriptionPlan?.id) {
    await knex('subscriptions').update({ plan_id: subscriptionPlan.id }).whereIn('plan_id', knex('subscription_plans').select('id').whereIn('slug', ['starter', 'pro', 'business']));
    await knex('subscription_plans').whereIn('slug', ['starter', 'pro', 'business']).update({ is_active: false, updated_at: knex.fn.now() });
  }

  await knex('modes').whereIn('slug', ['foto', 'videoblog']).update({ is_default: false });
  const [defaultMode] = await knex('modes').where({ slug: 'espejo' }).select('id', 'price_amount', 'price_currency').limit(1);
  if (defaultMode?.id) {
    const subscriptions = await knex('subscriptions').select('id');
    for (const subscription of subscriptions) {
      await knex('subscription_modes')
        .insert({
          subscription_id: subscription.id,
          mode_id: defaultMode.id,
          price_amount: defaultMode.price_amount,
          price_currency: defaultMode.price_currency,
          status: 'active',
        })
        .onConflict(['subscription_id', 'mode_id'])
        .merge({ price_amount: defaultMode.price_amount, price_currency: defaultMode.price_currency, status: 'active', updated_at: knex.fn.now() });
    }
  }
};
