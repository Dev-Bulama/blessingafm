'use strict';

/** Department -> category -> subcategory. [name, [subcategories]] */
module.exports = [
  {
    name: 'Food Market',
    slug: 'food-market',
    description: 'African and Caribbean groceries: grains, flours, spices, palm oil, frozen fish and meat, snacks, drinks and fresh produce.',
    children: [
      ['Grains, Rice & Flours', ['Rice', 'Garri & Cassava', 'Swallow Flours', 'Beans & Lentils'], true],
      ['Spices & Seasonings', ['Seasoning Cubes & Mixes', 'Ground Spices & Peppers', 'Soup Ingredients'], true],
      ['Oils & Sauces', ['Palm Oil', 'Cooking Oils', 'Sauces & Pastes'], false],
      ['Frozen & Fish', ['Frozen Fish', 'Frozen Meat & Poultry', 'Dried & Smoked Fish'], true],
      ['Snacks & Drinks', ['Chips & Snacks', 'Malt & Soft Drinks', 'Beverages & Milk'], true],
      ['Noodles & Pantry', ['Noodles & Pasta', 'Canned Goods'], false],
      ['Fresh Produce', ['Yams & Tubers', 'Plantain & Vegetables'], false],
    ],
  },
  {
    name: 'Beauty Store',
    slug: 'beauty-store',
    description: 'Hair extensions, wigs, braiding hair, hair care, skin care, cosmetics and accessories.',
    children: [
      ['Hair Extensions', ['Braiding Hair', 'Crochet Hair', 'Weaves & Bundles'], true],
      ['Wigs', ['Lace Front Wigs', 'Synthetic Wigs'], true],
      ['Hair Care', ['Shampoo & Conditioner', 'Oils & Treatments', 'Styling & Edge Control', 'Relaxers & Colour'], true],
      ['Skin Care', ['Soaps & Body Wash', 'Butters & Lotions'], true],
      ['Cosmetics', ['Face', 'Lips & Eyes'], false],
      ['Accessories', ['Combs, Brushes & Tools', 'Bonnets, Scarves & Caps'], false],
    ],
  },
];
