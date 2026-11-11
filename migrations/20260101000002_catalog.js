'use strict';

function base(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

exports.up = async function up(knex) {
  // Tree: department (parent_id NULL) -> category -> subcategory.
  await knex.schema.createTable('categories', (t) => {
    t.increments('id');
    t.integer('parent_id').unsigned().references('categories.id').onDelete('RESTRICT');
    t.string('name', 120).notNullable();
    t.string('slug', 140).notNullable().unique();
    t.string('description', 500);
    t.string('image', 255);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['parent_id', 'sort_order']);
    base(t);
  });

  await knex.schema.createTable('brands', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable().unique();
    t.string('slug', 140).notNullable().unique();
    t.string('image', 255);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id').unsigned().notNullable().references('categories.id').onDelete('RESTRICT');
    t.integer('brand_id').unsigned().references('brands.id').onDelete('SET NULL');
    t.string('name', 190).notNullable();
    t.string('slug', 200).notNullable().unique();
    t.string('sku', 64).notNullable().unique();
    t.string('short_description', 300);
    t.text('description');
    t.text('details'); // ingredients / product details tab
    // For products with variants these mirror the cheapest variant and the summed variant stock.
    t.integer('price_cents').unsigned().notNullable();
    t.integer('compare_at_cents').unsigned();
    t.integer('stock_qty').notNullable().defaultTo(0);
    t.integer('low_stock_threshold').notNullable().defaultTo(5);
    t.integer('weight_grams').unsigned().notNullable().defaultTo(0);
    t.boolean('has_variants').notNullable().defaultTo(false);
    t.string('variant_label', 40); // e.g. Size, Weight, Shade, Length, Colour
    t.boolean('is_taxable').notNullable().defaultTo(true);
    t.boolean('is_perishable').notNullable().defaultTo(false);
    t.boolean('is_frozen').notNullable().defaultTo(false);
    t.boolean('pickup_only').notNullable().defaultTo(false);
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.boolean('is_deal').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sales_count').unsigned().notNullable().defaultTo(0);
    t.decimal('rating_avg', 3, 2).notNullable().defaultTo(0);
    t.integer('rating_count').unsigned().notNullable().defaultTo(0);
    t.string('search_keywords', 1000); // denormalised brand + tags + variant SKUs for FULLTEXT
    t.string('meta_title', 190);
    t.string('meta_description', 300);
    t.timestamps(true, true);
    t.index(['is_active', 'category_id']);
    t.index(['is_active', 'price_cents']);
    t.index(['is_active', 'created_at']);
    t.index(['is_active', 'sales_count']);
    t.index(['brand_id']);
    base(t);
  });
  await knex.raw('ALTER TABLE products ADD FULLTEXT INDEX products_search_ft (name, sku, search_keywords)');

  await knex.schema.createTable('product_images', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('path', 255).notNullable();
    t.string('thumb_path', 255).notNullable();
    t.string('alt', 190);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'sort_order']);
    base(t);
  });

  await knex.schema.createTable('product_variants', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('name', 120).notNullable(); // option value, e.g. "1 kg" or "Colour 1B"
    t.string('sku', 64).notNullable().unique();
    t.integer('price_cents').unsigned().notNullable();
    t.integer('compare_at_cents').unsigned();
    t.integer('stock_qty').notNullable().defaultTo(0);
    t.integer('weight_grams').unsigned().notNullable().defaultTo(0);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['product_id', 'sort_order']);
    base(t);
  });

  await knex.schema.createTable('product_tags', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('tag', 60).notNullable();
    t.unique(['product_id', 'tag']);
    t.index(['tag']);
    base(t);
  });

  await knex.schema.createTable('inventory_logs', (t) => {
    t.bigIncrements('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('variant_id').unsigned().references('product_variants.id').onDelete('SET NULL');
    t.integer('change_qty').notNullable();
    t.integer('qty_after').notNullable();
    t.string('reason', 40).notNullable(); // order, restock, adjustment, import, initial
    t.string('note', 255);
    t.integer('order_id').unsigned();
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'created_at']);
    base(t);
  });
};

exports.down = async function down(knex) {
  for (const table of ['inventory_logs', 'product_tags', 'product_variants', 'product_images', 'products', 'brands', 'categories']) {
    await knex.schema.dropTableIfExists(table);
  }
};
