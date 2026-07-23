'use strict';

const axios = require('axios');
const PDFDocument = require('pdfkit');
const { CATEGORIES, CATEGORY_BLURBS } = require('./catalogueCategories');

const HIDDEN = new Set(['Personality Patches', 'Give Back']);
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const GAP = 12;
const COL_W = (PAGE_W - MARGIN * 2 - GAP) / 2;
const IMG_H = 118;
const PAD = 8;
const ROW_GAP = 10;
const CREAM = '#FBF6EC';
const INK = '#231F1A';
const MUTED = '#6E6459';
const TEAL = '#0F6E56';
const TEAL_DP = '#0A4B3B';
const LINE = '#E0D3BC';
const SAND = '#F2E7D5';

function formatInr(n) {
  const num = Math.round(Number(n) || 0);
  return `Rs. ${num.toLocaleString('en-IN')}`;
}

function displayPrice(product) {
  if (product.compareAt != null && product.compareAt > 0) {
    return formatInr(product.compareAt);
  }
  if (product.priceMin === product.priceMax) {
    return formatInr(product.priceMin);
  }
  return `${formatInr(product.priceMin)} – ${formatInr(product.priceMax)}`;
}

function truncate(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trim()}…`;
}

function productImageUrl(product) {
  let url = null;
  if (product.images?.[0]?.url) url = product.images[0].url;
  else if (product.image) url = product.image;
  if (!url) return null;

  try {
    const u = new URL(url);
    u.searchParams.set('width', '360');
    u.searchParams.set('height', '360');
    u.searchParams.set('crop', 'center');
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'TiltingHeadsCataloguePDF/1.0' },
      maxRedirects: 3,
    });
    const buf = Buffer.from(res.data);
    if (buf.length > 1_500_000) return null;
    return buf;
  } catch {
    return null;
  }
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()),
  );
  return results;
}

function groupSections(products) {
  const byCat = new Map();
  for (const p of products) {
    const cat = p.category || 'Uncategorized';
    if (HIDDEN.has(cat)) continue;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }

  const sections = [];
  CATEGORIES.forEach((name, index) => {
    if (HIDDEN.has(name)) return;
    const list = byCat.get(name);
    if (!list?.length) return;
    sections.push({
      id: index + 1,
      name,
      blurb: CATEGORY_BLURBS[name] || '',
      products: list.slice().sort((a, b) => a.title.localeCompare(b.title)),
    });
  });

  if (byCat.get('Uncategorized')?.length) {
    sections.push({
      id: 99,
      name: 'Uncategorized',
      blurb: 'Products missing a catalogue category.',
      products: byCat.get('Uncategorized'),
    });
  }

  return sections;
}

function cardCopy(product) {
  const title = truncate(product.title, 72);
  const desc = truncate(product.description || '', 110);
  const price = displayPrice(product);
  const chips = [];
  const imgCount = (product.images || []).length || (product.image ? 1 : 0);
  if (imgCount > 1) chips.push(`${imgCount} photos`);
  if ((product.variantCount || 0) > 1) chips.push(`${product.variantCount} options`);
  if ((product.inventoryTotal || 0) <= 0) chips.push('Out of stock');
  const chipLine = chips.join('  ·  ');
  const sku = product.sku ? String(product.sku) : '';
  const variants = product.variants || [];
  let options = '';
  if (variants.length > 1) {
    options = `Options: ${truncate(variants.slice(0, 6).map((v) => {
      const p = (v.compareAtPrice != null && v.compareAtPrice > 0) ? v.compareAtPrice : v.price;
      return `${v.title} (${formatInr(p)})`;
    }).join(' · '), 140)}`;
  }
  return { title, desc, price, chipLine, sku, options };
}

/** Accurate height using pdfkit text metrics — prevents overlap + wasted space */
function measureCardHeight(doc, product) {
  const textW = COL_W - PAD * 2;
  const copy = cardCopy(product);
  let h = IMG_H + PAD;

  doc.font('Helvetica-Bold').fontSize(9);
  h += doc.heightOfString(copy.title, { width: textW, lineGap: 1 }) + 3;

  if (copy.desc) {
    doc.font('Helvetica').fontSize(7.5);
    h += doc.heightOfString(copy.desc, { width: textW, lineGap: 1.2 }) + 4;
  }

  doc.font('Helvetica-Bold').fontSize(10);
  h += doc.heightOfString(copy.price, { width: textW }) + 3;

  if (copy.chipLine) {
    doc.font('Helvetica').fontSize(7);
    h += doc.heightOfString(copy.chipLine, { width: textW }) + 2;
  }
  if (copy.sku) {
    doc.font('Helvetica').fontSize(6.5);
    h += doc.heightOfString(copy.sku, { width: textW }) + 2;
  }
  if (copy.options) {
    doc.font('Helvetica').fontSize(6.5);
    h += doc.heightOfString(copy.options, { width: textW, lineGap: 1 }) + 2;
  }

  return h + PAD;
}

function drawCover(doc, { title, subtitle }) {
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(TEAL_DP);
  doc.rect(0, 0, PAGE_W, PAGE_H * 0.72).fill(TEAL);

  doc.fillColor(CREAM).font('Helvetica').fontSize(10)
    .text('TERVIGON COLLECTIVE  ·  TILTING HEADS', MARGIN, 72, {
      width: PAGE_W - MARGIN * 2,
    });

  doc.font('Helvetica-Bold').fontSize(34)
    .text(title, MARGIN, 120, { width: PAGE_W - MARGIN * 2 });

  doc.font('Helvetica').fontSize(12).fillColor('#F5C9A8')
    .text(subtitle, MARGIN, doc.y + 16, { width: PAGE_W - MARGIN * 2 });

  doc.fillColor(CREAM).fontSize(10)
    .text('Prices in INR  ·  Subject to change', MARGIN, PAGE_H - 60, {
      width: PAGE_W - MARGIN * 2,
    });
}

function newContentPage(doc) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(CREAM);
  doc.fillColor(INK);
  doc.y = MARGIN;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE_H - MARGIN) {
    newContentPage(doc);
  }
}

function drawSectionHeader(doc, section) {
  ensureSpace(doc, 56);
  const y = doc.y;
  doc.fillColor(SAND).font('Helvetica-Bold').fontSize(22)
    .text(String(section.id).padStart(2, '0'), MARGIN, y, { width: 36 });

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
    .text(section.name, MARGIN + 40, y + 2, { width: PAGE_W - MARGIN * 2 - 40 });

  let bottom = doc.y;
  if (section.blurb) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(section.blurb, MARGIN + 40, doc.y + 1, { width: PAGE_W - MARGIN * 2 - 40 });
    bottom = doc.y;
  }

  const lineY = Math.max(bottom, y + 22) + 6;
  doc.moveTo(MARGIN, lineY)
    .lineTo(PAGE_W - MARGIN, lineY)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();

  doc.y = lineY + 12;
}

/**
 * Draw card at (x,y) with known height. Content is clipped to that box.
 * Returns the height used.
 */
function drawProductCard(doc, product, imageBuf, x, y, cardH) {
  const copy = cardCopy(product);
  const textW = COL_W - PAD * 2;

  doc.save();
  // Clip so text can never spill into the next row
  doc.rect(x, y, COL_W, cardH).clip();

  doc.rect(x, y, COL_W, cardH).fill('#FFFFFF');
  doc.rect(x, y, COL_W, IMG_H).fill(SAND);

  if (imageBuf) {
    try {
      doc.image(imageBuf, x + 1, y + 1, {
        fit: [COL_W - 2, IMG_H - 2],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // ignore
    }
  }

  let ty = y + IMG_H + PAD;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
    .text(copy.title, x + PAD, ty, { width: textW, lineGap: 1 });
  ty = doc.y + 3;

  if (copy.desc) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
      .text(copy.desc, x + PAD, ty, { width: textW, lineGap: 1.2 });
    ty = doc.y + 4;
  }

  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(10)
    .text(copy.price, x + PAD, ty, { width: textW });
  ty = doc.y + 3;

  if (copy.chipLine) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
      .text(copy.chipLine, x + PAD, ty, { width: textW });
    ty = doc.y + 2;
  }
  if (copy.sku) {
    doc.fillColor('#A69B8C').font('Helvetica').fontSize(6.5)
      .text(copy.sku, x + PAD, ty, { width: textW });
    ty = doc.y + 2;
  }
  if (copy.options) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.5)
      .text(copy.options, x + PAD, ty, { width: textW, lineGap: 1 });
  }

  doc.restore();

  // Border on top of clipped content
  doc.rect(x, y, COL_W, cardH).strokeColor(LINE).lineWidth(0.8).stroke();

  return cardH;
}

async function prefetchSectionImages(products) {
  const map = new Map();
  await mapPool(products, 16, async (product) => {
    const buf = await fetchImageBuffer(productImageUrl(product));
    if (buf) map.set(product.id, buf);
  });
  return map;
}

async function streamCataloguePdf(res, {
  products,
  category = null,
  filename = 'tilting-heads-catalogue.pdf',
}) {
  let list = products.filter((p) => !HIDDEN.has(p.category));
  if (category) {
    list = list.filter((p) => p.category === category);
  }

  const sections = category
    ? [{
      id: Math.max(1, CATEGORIES.indexOf(category) + 1),
      name: category,
      blurb: CATEGORY_BLURBS[category] || '',
      products: list.slice().sort((a, b) => a.title.localeCompare(b.title)),
    }]
    : groupSections(list);

  const productCount = sections.reduce((n, s) => n + s.products.length, 0);
  if (!productCount) {
    res.status(404).json({ error: 'No products found for this PDF export' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    autoFirstPage: true,
    info: {
      Title: category || 'Tilting Heads Product Catalogue',
      Author: 'Tilting Heads',
      Creator: 'Tilting Heads Catalogue',
    },
  });

  doc.pipe(res);

  const title = category || 'Tilting Heads Product Catalogue';
  const subtitle = category
    ? `${productCount} products`
    : `${sections.length} categories · ${productCount} products`;

  drawCover(doc, { title, subtitle });
  newContentPage(doc);

  for (const section of sections) {
    const imageMap = await prefetchSectionImages(section.products);
    drawSectionHeader(doc, section);

    for (let i = 0; i < section.products.length; i += 2) {
      const left = section.products[i];
      const right = section.products[i + 1];

      const leftH = measureCardHeight(doc, left);
      const rightH = right ? measureCardHeight(doc, right) : 0;
      // Same row height so both cards align; use the taller one
      const rowH = Math.max(leftH, rightH);

      ensureSpace(doc, rowH + ROW_GAP);
      const y = doc.y;

      drawProductCard(doc, left, imageMap.get(left.id), MARGIN, y, rowH);
      if (right) {
        drawProductCard(doc, right, imageMap.get(right.id), MARGIN + COL_W + GAP, y, rowH);
      }

      // Advance exactly by used height — fill the page instead of guessing
      doc.y = y + rowH + ROW_GAP;
    }

    imageMap.clear();
  }

  doc.end();
}

module.exports = {
  streamCataloguePdf,
  HIDDEN,
};
