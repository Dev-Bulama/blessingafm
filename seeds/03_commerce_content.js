'use strict';
const pages = require('./data/pages');

const cents = (d) => Math.round(d * 100);

async function isEmpty(knex, table) {
  const row = await knex(table).count({ n: '*' }).first();
  return Number(row.n) === 0;
}

/** Delivery zones, shipping rates, pickup slots, coupons, banners, pages and FAQs. Each table is seeded only when empty. */
exports.seed = async function seed(knex) {
  if (await isEmpty(knex, 'delivery_zones')) {
    await knex('delivery_zones').insert([
      { name: 'Newmarket', postal_prefixes: 'L3X, L3Y', fee_cents: cents(5), min_order_cents: cents(30), free_threshold_cents: cents(75), sort_order: 1 },
      { name: 'Aurora & East Gwillimbury', postal_prefixes: 'L4G, L9N, L0G', fee_cents: cents(8), min_order_cents: cents(40), free_threshold_cents: cents(100), sort_order: 2 },
      { name: 'Bradford, Keswick, Stouffville & King', postal_prefixes: 'L3Z, L4P, L4A, L7B', fee_cents: cents(12), min_order_cents: cents(50), free_threshold_cents: cents(150), sort_order: 3 },
      { name: 'Richmond Hill', postal_prefixes: 'L4B, L4C, L4E, L4S', fee_cents: cents(12), min_order_cents: cents(50), free_threshold_cents: cents(150), sort_order: 4 },
      { name: 'Markham & Vaughan', postal_prefixes: 'L3P, L3R, L3S, L6B, L6C, L6E, L6G, L4H, L4J, L4K, L4L, L6A', fee_cents: cents(15), min_order_cents: cents(60), free_threshold_cents: cents(200), sort_order: 5 },
    ]);
  }

  if (await isEmpty(knex, 'shipping_rates')) {
    await knex('shipping_rates').insert([
      { name: 'Up to 2 kg', min_weight_grams: 0, max_weight_grams: 2000, rate_cents: cents(14.99) },
      { name: '2 to 5 kg', min_weight_grams: 2001, max_weight_grams: 5000, rate_cents: cents(19.99) },
      { name: '5 to 10 kg', min_weight_grams: 5001, max_weight_grams: 10000, rate_cents: cents(27.99) },
      { name: '10 to 20 kg', min_weight_grams: 10001, max_weight_grams: 20000, rate_cents: cents(39.99) },
      { name: '20 to 30 kg', min_weight_grams: 20001, max_weight_grams: 30000, rate_cents: cents(54.99) },
    ]);
  }

  if (await isEmpty(knex, 'pickup_slots')) {
    const slots = [];
    for (let day = 1; day <= 6; day += 1) { // Monday to Saturday
      for (const [start, end] of [['10:00', '12:00'], ['12:00', '14:00'], ['14:00', '16:00'], ['16:00', '18:00'], ['18:00', '20:00']]) {
        slots.push({ day_of_week: day, start_time: `${start}:00`, end_time: `${end}:00`, capacity: 8 });
      }
    }
    for (const [start, end] of [['12:00', '14:00'], ['14:00', '16:00'], ['16:00', '18:00']]) { // Sunday
      slots.push({ day_of_week: 0, start_time: `${start}:00`, end_time: `${end}:00`, capacity: 6 });
    }
    await knex('pickup_slots').insert(slots);
  }

  if (await isEmpty(knex, 'coupons')) {
    await knex('coupons').insert([
      { code: 'WELCOME10', description: '10% off your first order over $30', type: 'percent', value: 10, min_spend_cents: cents(30) },
      { code: 'SAVE5', description: '$5 off orders over $50', type: 'fixed', value: cents(5), min_spend_cents: cents(50) },
    ]);
  }

  if (await isEmpty(knex, 'banners')) {
    await knex('banners').insert([
      { title: 'Grand Opening', subtitle: 'Your new home for African groceries and beauty at 77 Davis Drive, Newmarket.', cta_label: 'Shop the Food Market', cta_url: '/c/food-market', theme: 'yellow', sort_order: 1 },
      { title: 'Taste of Home', subtitle: 'Garri, pounded yam, egusi, palm oil, stockfish and everything for the pot.', cta_label: 'Shop Groceries', cta_url: '/c/grains-rice-and-flours', theme: 'green', sort_order: 2 },
      { title: 'Braids, Wigs & Beauty', subtitle: 'Braiding hair in every colour, lace wigs, shea butter, black soap and more.', cta_label: 'Shop the Beauty Store', cta_url: '/c/beauty-store', theme: 'red', sort_order: 3 },
    ]);
  }

  if (await isEmpty(knex, 'pages')) {
    await knex('pages').insert(pages.map((p) => ({ ...p, body_html: p.body_html.trim() })));
  }

  if (await isEmpty(knex, 'faqs')) {
    const faqs = [
      ['Where is the store?', 'We are at 77 Davis Drive, Newmarket, Ontario. You will find a map and our opening hours at the bottom of every page.'],
      ['Can I order online and pick up in store?', 'Yes. Choose "In-store pickup" at checkout, then pick a day and time slot. Pickup is free and we will email you when your order is ready.'],
      ['Do you deliver?', 'We deliver in Newmarket and nearby York Region communities including Aurora, East Gwillimbury, Bradford, Richmond Hill, Markham and Vaughan. Enter your postal code at checkout to see the fee and minimum order for your area.'],
      ['Do you ship across Canada?', 'Yes, shelf-stable groceries and beauty products ship anywhere in Canada at a flat rate based on weight. Frozen, perishable and pickup-only items cannot be shipped.'],
      ['Why can I not ship some of the items in my cart?', 'Frozen food, fresh produce and very heavy items would not arrive in good condition by mail. Checkout shows which items are affected so you can remove them, or switch to pickup or local delivery.'],
      ['How can I pay?', 'By credit or debit card, Apple Pay or Google Pay through Stripe; by Interac e-Transfer; or in store when you collect a pickup order.'],
      ['How does Interac e-Transfer payment work?', 'Place your order, then send an e-Transfer for the order total to the email address shown on your confirmation, with your order number in the message. We prepare your order once the transfer is accepted.'],
      ['Why is tax charged on some items and not others?', 'In Ontario, basic groceries such as rice, flour, beans, fish and cooking oil are zero-rated, so no HST is charged. HST of 13% applies to taxable items such as beauty products, snacks and soft drinks. Your cart shows the tax before you pay.'],
      ['Can I return an item?', 'Unopened beauty products can be returned within 14 days. Food, and opened hair or beauty products, cannot be returned for hygiene and safety reasons, but we will always replace or refund anything that arrives damaged or incorrect. See our Returns & Refunds page.'],
      ['I cannot find a product. Can you get it for me?', 'Very likely. Send us a message or ask in store and we will check with our suppliers.'],
    ];
    await knex('faqs').insert(faqs.map(([question, answer], i) => ({ question, answer, sort_order: i + 1 })));
  }

};
