'use strict';

const BRAND_ID = 20;
const REFRESH_MS = 30000;
const HIDDEN_CATEGORIES = new Set(['Personality Patches', 'Give Back']);

const state = {
  sections: [],
  meta: null,
  search: '',
  stock: '',
  product: null,
  activeImage: 0,
};

function formatInr(n) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function displayPrice(product) {
  if (product.compareAt != null && product.compareAt > 0) {
    return { main: product.compareAt, fallback: null };
  }
  if (product.priceMin === product.priceMax) {
    return { main: product.priceMin, fallback: null };
  }
  return { main: product.priceMin, fallback: product.priceMax };
}

function formatPrice(product) {
  const { main, fallback } = displayPrice(product);
  if (fallback != null) {
    return `${formatInr(main)} – ${formatInr(fallback)}`;
  }
  return formatInr(main);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function padNum(n) {
  return String(n).padStart(2, '0');
}

function productImages(product) {
  if (product.images && product.images.length) return product.images;
  if (product.image) return [{ url: product.image, altText: product.title }];
  return [];
}

function productHref(handle) {
  return `#/product/${encodeURIComponent(handle)}`;
}

function parseRoute() {
  const hash = window.location.hash || '';
  const match = hash.match(/^#\/product\/(.+)$/);
  if (match) {
    return { name: 'product', handle: decodeURIComponent(match[1]) };
  }
  return { name: 'catalogue' };
}

function filterProduct(product) {
  if (state.stock === 'in' && product.inventoryTotal <= 0) return false;
  if (state.stock === 'out' && product.inventoryTotal > 0) return false;
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  return (
    product.title.toLowerCase().includes(q)
    || (product.sku || '').toLowerCase().includes(q)
    || (product.tags || []).some((t) => t.toLowerCase().includes(q))
    || (product.handle || '').toLowerCase().includes(q)
  );
}

/** Catalogue grid card — click opens shared product detail page */
function renderCard(product) {
  const chips = [];
  const images = productImages(product);
  if (images.length > 1) {
    chips.push(`<span class="chip">${images.length} photos</span>`);
  }
  if (product.variantCount > 1) {
    chips.push(`<span class="chip">${product.variantCount} options</span>`);
  }
  if (product.inventoryTotal <= 0) {
    chips.push('<span class="chip oos">Out of stock</span>');
  }

  const cover = images[0]
    ? `<img loading="lazy" src="${escapeHtml(images[0].url)}" alt="${escapeHtml(product.title)}">`
    : '';

  return `
    <a class="card" href="${productHref(product.handle)}">
      <div class="shot">${cover}</div>
      <div class="body">
        <h3>${escapeHtml(product.title)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="meta">
          <span class="price">${formatPrice(product)}</span>
          ${chips.join('')}
        </div>
        ${product.sku ? `<span class="sku">${escapeHtml(product.sku)}</span>` : ''}
      </div>
    </a>
  `;
}

/**
 * Reusable product detail component (PDP).
 * Main image + thumbnails, full info — no cart / buy buttons.
 */
function renderProductDetail(product, activeIndex = 0) {
  const images = productImages(product);
  const idx = Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0));
  const active = images[idx];

  const thumbs = images.length
    ? `<div class="pdp-thumbs" role="list">
        ${images.map((img, i) => `
          <button
            type="button"
            class="pdp-thumb${i === idx ? ' is-active' : ''}"
            data-image-index="${i}"
            aria-label="Photo ${i + 1} of ${images.length}"
            role="listitem"
          >
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.altText || product.title)}">
          </button>
        `).join('')}
      </div>`
    : '';

  const main = active
    ? `<div class="pdp-main">
        <img src="${escapeHtml(active.url)}" alt="${escapeHtml(active.altText || product.title)}">
      </div>`
    : `<div class="pdp-main pdp-main-empty">No image</div>`;

  const fullText = product.descriptionFull || product.description || '';
  const paragraphs = fullText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

  const variants = product.variants || [];
  const variantBlock = variants.length > 1
    ? `<div class="pdp-variants">
        <h3>Options</h3>
        <table>
          <thead>
            <tr><th>Option</th><th>SKU</th><th>Price</th><th>Stock</th></tr>
          </thead>
          <tbody>
            ${variants.map((v) => {
              const price = (v.compareAtPrice != null && v.compareAtPrice > 0)
                ? v.compareAtPrice
                : v.price;
              return `<tr>
                <td>${escapeHtml(v.title)}</td>
                <td>${escapeHtml(v.sku || '—')}</td>
                <td>${formatInr(price)}</td>
                <td>${v.inventoryQuantity > 0 ? v.inventoryQuantity : 'Out'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`
    : '';

  const stockLabel = product.inventoryTotal > 0
    ? `${product.inventoryTotal} in stock`
    : 'Out of stock';

  return `
    <div class="pdp-topbar wrap">
      <a class="pdp-back" href="#/">&larr; Back to catalogue</a>
    </div>
    <article class="pdp wrap">
      <div class="pdp-media">
        ${main}
        ${thumbs}
      </div>
      <div class="pdp-info">
        <div class="pdp-brand">Tilting Heads</div>
        <h1>${escapeHtml(product.title)}</h1>
        <div class="pdp-price-row">
          <span class="pdp-price">${formatPrice(product)}</span>
          <span class="pdp-stock${product.inventoryTotal <= 0 ? ' oos' : ''}">${stockLabel}</span>
        </div>
        <dl class="pdp-meta">
          ${product.category ? `<div><dt>Category</dt><dd>${escapeHtml(product.category)}</dd></div>` : ''}
          ${product.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(product.sku)}</dd></div>` : ''}
          ${product.productType ? `<div><dt>Type</dt><dd>${escapeHtml(product.productType)}</dd></div>` : ''}
        </dl>
        <div class="pdp-desc">
          <h2>Product information</h2>
          ${paragraphs || '<p>No description available.</p>'}
        </div>
        ${variantBlock}
        ${(product.tags || []).length ? `
          <div class="pdp-tags">
            ${product.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    </article>
  `;
}

function renderCatalogue() {
  const toc = document.getElementById('toc');
  const root = document.getElementById('catalogue-root');

  const visibleSections = state.sections
    .map((section) => ({
      ...section,
      products: section.products.filter(filterProduct),
    }))
    .filter((section) => section.products.length > 0);

  toc.innerHTML = visibleSections.map((section) => `
    <a class="toc-row" href="#cat-${section.id}">
      <span class="toc-num">${padNum(section.id)}</span>
      <span class="toc-name">${escapeHtml(section.name)}</span>
      <span class="toc-dots"></span>
      <span class="toc-count">${section.products.length}</span>
    </a>
  `).join('');

  if (!visibleSections.length) {
    root.innerHTML = '<div class="loading">No products match your filters.</div>';
    return;
  }

  root.innerHTML = visibleSections.map((section) => `
    <section class="cat" id="cat-${section.id}">
      <header class="cat-head">
        <span class="cat-num">${padNum(section.id)}</span>
        <div>
          <h2>${escapeHtml(section.name)}</h2>
          <p>${escapeHtml(section.blurb)}</p>
        </div>
        <span class="cat-count">${section.products.length} products</span>
      </header>
      <div class="grid">
        ${section.products.map(renderCard).join('')}
      </div>
    </section>
  `).join('');
}

function updateStats(meta, sections) {
  const productCount = sections.reduce((n, s) => n + s.products.length, 0);
  const inStock = sections.reduce(
    (n, s) => n + s.products.filter((p) => p.inventoryTotal > 0).length,
    0,
  );

  document.getElementById('stat-products').textContent = String(productCount);
  document.getElementById('stat-categories').textContent = String(sections.length);
  document.getElementById('stat-stock').textContent = String(inStock);

  const synced = meta?.lastSyncedAt || meta?.lastSyncAt
    ? new Date(meta.lastSyncedAt || meta.lastSyncAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : '—';
  document.getElementById('live-status').textContent = `Live · last sync ${synced}`;
}

async function loadCatalogue() {
  const res = await fetch(`/api/v1/catalogue/${BRAND_ID}/catalogue`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  state.sections = (data.sections || []).filter(
    (section) => !HIDDEN_CATEGORIES.has(section.name),
  );
  state.meta = data.meta || null;
  updateStats(state.meta, state.sections);
  if (parseRoute().name === 'catalogue') {
    renderCatalogue();
  }
}

async function loadProduct(handle) {
  const view = document.getElementById('view-product');
  view.innerHTML = '<div class="wrap loading">Loading product…</div>';

  const res = await fetch(`/api/v1/catalogue/${BRAND_ID}/products/${encodeURIComponent(handle)}`);
  if (!res.ok) {
    view.innerHTML = `
      <div class="wrap">
        <a class="pdp-back" href="#/">&larr; Back to catalogue</a>
        <div class="error">Product not found.</div>
      </div>`;
    return;
  }

  const data = await res.json();
  state.product = data.product;
  state.activeImage = 0;
  view.innerHTML = renderProductDetail(state.product, 0);
  document.title = `${state.product.title} — Tilting Heads`;
  window.scrollTo(0, 0);
}

function showViews(routeName) {
  const cat = document.getElementById('view-catalogue');
  const prod = document.getElementById('view-product');
  if (routeName === 'product') {
    cat.classList.add('hidden');
    prod.classList.remove('hidden');
  } else {
    prod.classList.add('hidden');
    cat.classList.remove('hidden');
    document.title = 'Tilting Heads — Product Catalogue';
  }
}

async function route() {
  const r = parseRoute();
  showViews(r.name);
  if (r.name === 'product') {
    await loadProduct(r.handle);
  } else if (state.sections.length) {
    renderCatalogue();
  }
}

function wireFilters() {
  document.getElementById('search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    if (parseRoute().name === 'catalogue') renderCatalogue();
  });
  document.getElementById('stock-filter').addEventListener('change', (e) => {
    state.stock = e.target.value;
    if (parseRoute().name === 'catalogue') renderCatalogue();
  });
}

function wireProductGallery() {
  document.getElementById('view-product').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-image-index]');
    if (!btn || !state.product) return;
    const index = Number(btn.getAttribute('data-image-index'));
    if (!Number.isFinite(index)) return;
    state.activeImage = index;
    document.getElementById('view-product').innerHTML =
      renderProductDetail(state.product, index);
  });
}

async function boot() {
  wireFilters();
  wireProductGallery();
  window.addEventListener('hashchange', () => {
    route().catch((err) => console.error(err));
  });

  try {
    await loadCatalogue();
    await route();
  } catch (err) {
    document.getElementById('catalogue-root').innerHTML =
      `<div class="error">Could not load catalogue: ${escapeHtml(err.message)}</div>`;
    document.getElementById('live-status').textContent = 'Offline';
  }

  setInterval(() => {
    loadCatalogue().catch(() => {});
  }, REFRESH_MS);
}

boot();
