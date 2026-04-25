/**
 * @param {import('knex').Knex} knex
 */
exports.seed = async function seed(knex) {
  await knex('post').del();

  await knex('post').insert([
    {
      id: 1,
      title: 'oooo',
      image_url: 'https://pub-b9aa5befe3254b02af582e1ca0b1821b.r2.dev/3103805c-f7d5-4cf3-88cf-7790f351b10a',
      media_type: 'image/jpeg',
    },
    {
      id: 2,
      title: 'mmm',
      image_url: 'https://pub-b9aa5befe3254b02af582e1ca0b1821b.r2.dev/90ea33c1-2bfa-4ac4-b3e2-c27c162d42ae',
      media_type: 'video/mp4',
    },
    {
      id: 3,
      title: 'fff',
      image_url: 'https://pub-b9aa5befe3254b02af582e1ca0b1821b.r2.dev/85336e27-d9ae-4ce4-96a5-8b0e8a3f08e7',
      media_type: 'video/mp4',
    },
    {
      id: 4,
      title: 'ddd',
      image_url: 'https://pub-b9aa5befe3254b02af582e1ca0b1821b.r2.dev/7310ffdf-734a-4f57-8af5-1df261042fa7',
      media_type: 'image/jpeg',
    },
  ]);

  await knex.raw('ALTER TABLE post AUTO_INCREMENT = 5');
};
