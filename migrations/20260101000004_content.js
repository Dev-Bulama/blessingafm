'use strict';

function base(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

exports.up = async function up(knex) {
  await knex.schema.createTable('pages', (t) => {
    t.increments('id');
    t.string('slug', 140).notNullable().unique();
    t.string('title', 190).notNullable();
    t.specificType('body_html', 'mediumtext');
    t.string('meta_title', 190);
    t.string('meta_description', 300);
    t.boolean('is_published').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('banners', (t) => {
    t.increments('id');
    t.string('title', 120).notNullable();
    t.string('subtitle', 255);
    t.string('cta_label', 60);
    t.string('cta_url', 255);
    t.string('image', 255);
    t.enu('theme', ['yellow', 'red', 'green', 'black']).notNullable().defaultTo('yellow');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('faqs', (t) => {
    t.increments('id');
    t.string('question', 255).notNullable();
    t.text('answer').notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('newsletter_subscribers', (t) => {
    t.increments('id');
    t.string('email', 190).notNullable().unique();
    t.string('source', 40);
    t.specificType('unsubscribe_token', 'char(40)').notNullable();
    t.boolean('is_subscribed').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('contact_messages', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('email', 190).notNullable();
    t.string('phone', 30);
    t.string('subject', 190);
    t.text('message').notNullable();
    t.boolean('is_read').notNullable().defaultTo(false);
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now()).index();
    base(t);
  });
};

exports.down = async function down(knex) {
  for (const table of ['contact_messages', 'newsletter_subscribers', 'faqs', 'banners', 'pages']) {
    await knex.schema.dropTableIfExists(table);
  }
};
