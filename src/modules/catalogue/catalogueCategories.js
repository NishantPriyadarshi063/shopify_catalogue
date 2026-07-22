'use strict';

const fs = require('fs');
const path = require('path');

const CATEGORIES = [
  'Walk & Adventure',
  'Groom & Care',
  'Rest & Comfort',
  'Play & Instinct',
  'Feed & Hydrate',
  "Season's Need",
  'Travel & On-the-Go',
  'Scratch & Climb',
  'Home & Hygiene',
  'Wear Your Bond',
  'Health & First Aid',
  'Training & Behavior',
  'Treats & Food',
  'Care Kits & Combos',
  'Personality Patches',
  'Give Back',
];

const CATEGORY_BLURBS = {
  'Walk & Adventure': 'Harnesses, leashes, collars, boots and everything the daily walk demands.',
  'Groom & Care': 'Shampoos, brushes, clippers and paw care for coat health year-round.',
  'Rest & Comfort': 'Beds, caves, mats and hideaways built for deep, undisturbed sleep.',
  'Play & Instinct': 'Chews, puzzles and enrichment that work the body and the brain.',
  'Feed & Hydrate': 'Bowls, fountains and slow feeders for calmer, healthier mealtimes.',
  "Season's Need": 'Raincoats, cooling vests and winter wear for every Indian season.',
  'Travel & On-the-Go': 'Carriers, backpacks and car gear for pets who come along.',
  'Scratch & Climb': 'Scratchers, lounges and tunnels that satisfy natural cat instinct.',
  'Home & Hygiene': 'Litter systems, mats and sprays that keep the home fresh.',
  'Wear Your Bond': 'Apparel, festive wear and matching sets for pet and parent.',
  'Health & First Aid': 'Everyday recovery and protection essentials.',
  'Training & Behavior': 'Tools that make good habits easier to build.',
  'Treats & Food': 'Treats worth working for.',
  'Care Kits & Combos': 'Curated bundles that solve a whole routine, not just one step.',
  'Personality Patches': "Add-on patches for harnesses and bandanas — pick your pet's character.",
  'Give Back': 'Tilting Hearts donation packages supporting community and rescue animals.',
};

let seedBySku = null;
let seedByTitle = null;

function loadSeed() {
  if (seedBySku) return;
  seedBySku = new Map();
  seedByTitle = new Map();
  try {
    const seedPath = path.join(__dirname, '../../../data/category-seed.json');
    const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const [category, entry] of Object.entries(raw)) {
      for (const sku of entry.skus || []) {
        if (sku) seedBySku.set(String(sku).trim().toUpperCase(), category);
      }
      for (const title of entry.titles || []) {
        if (title) seedByTitle.set(String(title).trim().toLowerCase(), category);
      }
    }
  } catch {
    // seed optional until first extract
  }
}

function resolveCategory({ metafieldValue, title, sku, tags = [], productType = '' }) {
  loadSeed();

  const fromMeta = String(metafieldValue || '').trim();
  if (fromMeta && CATEGORIES.includes(fromMeta)) {
    return fromMeta;
  }

  if (sku && seedBySku.has(String(sku).trim().toUpperCase())) {
    return seedBySku.get(String(sku).trim().toUpperCase());
  }

  if (title && seedByTitle.has(String(title).trim().toLowerCase())) {
    return seedByTitle.get(String(title).trim().toLowerCase());
  }

  const hay = `${title} ${productType} ${(tags || []).join(' ')}`.toLowerCase();

  const rules = [
    ['Give Back', [/donation/, /package —/, /neighbourhood nourishment/, /full circle impact/, /recovery & rescue/]],
    ['Personality Patches', [/patch/, /pack leader/, /sniff squad/, /socially selective/, /gentle giant/, /cuddler not/]],
    ['Care Kits & Combos', [/kit\b/, /combo\b/, /starter pack/, /bath duo/]],
    ['Treats & Food', [/jerhigh/, /dog treat/, /treat stick/]],
    ['Training & Behavior', [/clicksmart/, /trainer/, /clicker/]],
    ['Health & First Aid', [/bandage/, /heat wrap/, /leg supporter/, /first aid/]],
    ['Scratch & Climb', [/scratch/, /tunnel/, /scratcher/]],
    ['Home & Hygiene', [/litter/, /odourshield/, /sanora tray/]],
    ['Travel & On-the-Go', [/carrier/, /backpack/, /stroller/, /tote bag/, /car seat/, /crate/]],
    ["Season's Need", [/raincoat/, /cooling vest/, /puffer/, /winter jacket/, /drizzlecape/, /stormguard/, /rover raincoat/]],
    ['Feed & Hydrate', [/fountain/, /feeder/, /bowl/, /sipmate/, /hydration/, /slow feeder/, /lick mat/]],
    ['Rest & Comfort', [/bed\b/, /mat\b/, /hut\b/, /cave\b/, /playpen/, /cocoon/, /hammock/, /blanket/]],
    ['Play & Instinct', [/toy\b/, /chew/, /puzzle/, /ball\b/, /squeak/, /treat maze/, /playboard/]],
    ['Groom & Care', [/shampoo/, /brush/, /glove/, /trimmer/, /clipper/, /conditioner/, /deodorant/, /paw balm/, /paw cleanser/, /wipes/, /nail cutter/]],
    ['Wear Your Bond', [/t-shirt/, /hoodie/, /bandana/, /kurta/, /lehenga/, /frock/, /shirt\b/, /romper/, /matching fit/]],
    ['Walk & Adventure', [/harness/, /leash/, /collar/, /boots/, /shoes/, /muzzle/, /poop/, /socks/, /sneaks/]],
  ];

  for (const [category, patterns] of rules) {
    if (patterns.some((re) => re.test(hay))) {
      return category;
    }
  }

  return 'Uncategorized';
}

module.exports = {
  CATEGORIES,
  CATEGORY_BLURBS,
  resolveCategory,
};
