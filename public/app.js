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
  imageFormat: 'jpeg',
  imageDownloadBusy: false,
  selectedHandles: new Set(),
  bulkFormat: 'jpeg',
  bulkBusy: false,
  bulkProgress: '',
};

const IMAGE_FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg', quality: 0.95, label: 'JPEG' },
  png: { mime: 'image/png', ext: 'png', quality: undefined, label: 'PNG' },
  webp: { mime: 'image/webp', ext: 'webp', quality: 0.92, label: 'WEBP' },
};

const BULK_CONCURRENCY = 5;
const BULK_WARN_PRODUCTS = 50;

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

/** Strip Shopify CDN resize params / size suffixes so we fetch the original file. */
function shopifyOriginalUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    ['width', 'height', 'crop', 'pad_color'].forEach((k) => u.searchParams.delete(k));
    u.pathname = u.pathname.replace(
      /_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x\d*(?:@[23]x)?)(?=\.[a-z0-9]+$)/i,
      '',
    );
    return u.toString();
  } catch {
    return url;
  }
}

function mimeToFormat(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpeg';
  return null;
}

function urlToFormat(url) {
  const match = String(url || '').match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'png') return 'png';
  if (ext === 'webp') return 'webp';
  return null;
}

function triggerBlobDownload(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for conversion'));
    img.src = url;
  });
}

async function canvasEncode(img, formatKey) {
  const cfg = IMAGE_FORMATS[formatKey];
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  if (formatKey === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, cfg.mime, cfg.quality);
  });
  if (!blob) throw new Error(`Browser could not encode ${cfg.label}`);
  return blob;
}

async function fetchOriginalBlob(url) {
  const original = shopifyOriginalUrl(url);
  const proxy = `/api/v1/catalogue/${BRAND_ID}/image?url=${encodeURIComponent(original)}`;
  const res = await fetch(proxy);
  if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
  const blob = await res.blob();
  return { blob, url: original, contentType: blob.type || res.headers.get('content-type') || '' };
}

function supportsWebpEncode() {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function convertImageBlob(sourceUrl, formatKey) {
  if (formatKey === 'webp' && !supportsWebpEncode()) {
    throw new Error('This browser cannot export WEBP — try JPEG or PNG');
  }

  const { blob, url, contentType } = await fetchOriginalBlob(sourceUrl);
  const sourceFormat = mimeToFormat(contentType) || urlToFormat(url);
  if (sourceFormat === formatKey) {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(objectUrl);
    return await canvasEncode(img, formatKey);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageDownloadFilename(product, index, formatKey, total) {
  const base = slugifyFilename(product.handle || product.sku || product.title || 'product');
  const ext = IMAGE_FORMATS[formatKey].ext;
  if (total > 1) return `${base}-${String(index + 1).padStart(2, '0')}.${ext}`;
  return `${base}.${ext}`;
}

async function downloadProductImage(product, index, formatKey) {
  const images = productImages(product);
  const image = images[index];
  if (!image?.url) throw new Error('No image to download');
  const blob = await convertImageBlob(image.url, formatKey);
  triggerBlobDownload(blob, imageDownloadFilename(product, index, formatKey, images.length));
}

async function downloadAllProductImages(product, formatKey) {
  const images = productImages(product);
  if (!images.length) throw new Error('No images to download');
  for (let i = 0; i < images.length; i += 1) {
    const blob = await convertImageBlob(images[i].url, formatKey);
    triggerBlobDownload(blob, imageDownloadFilename(product, i, formatKey, images.length));
    if (i < images.length - 1) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

function setImageDownloadBusy(busy) {
  state.imageDownloadBusy = busy;
  document.querySelectorAll('[data-download-image], [data-download-all-images]').forEach((el) => {
    el.disabled = busy;
  });
  document.querySelectorAll('[data-image-format]').forEach((el) => {
    el.disabled = busy;
  });
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

/** Catalogue grid card — checkbox selects; body opens product detail */
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
  const selected = state.selectedHandles.has(product.handle);
  const hasImages = images.length > 0;

  return `
    <article class="card${selected ? ' is-selected' : ''}${!hasImages ? ' no-images' : ''}" data-handle="${escapeHtml(product.handle)}">
      <label class="card-check" title="${hasImages ? 'Select for image download' : 'No images to download'}">
        <input
          type="checkbox"
          data-select-product="${escapeHtml(product.handle)}"
          ${selected ? 'checked' : ''}
          ${!hasImages || state.bulkBusy ? 'disabled' : ''}
          aria-label="Select ${escapeHtml(product.title)}"
        >
      </label>
      <a class="card-link" href="${productHref(product.handle)}">
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
    </article>
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

  const format = IMAGE_FORMATS[state.imageFormat] ? state.imageFormat : 'jpeg';
  const busy = state.imageDownloadBusy;
  const downloadBar = images.length
    ? `<div class="pdp-download">
        <div class="pdp-download-label">Download image</div>
        <div class="pdp-format" role="group" aria-label="Image format">
          ${Object.entries(IMAGE_FORMATS).map(([key, cfg]) => `
            <button
              type="button"
              class="pdp-format-btn${format === key ? ' is-active' : ''}"
              data-image-format="${key}"
              ${busy ? 'disabled' : ''}
            >${cfg.label}</button>
          `).join('')}
        </div>
        <div class="pdp-download-actions">
          <button
            type="button"
            class="btn-download pdp-dl-btn"
            data-download-image
            ${busy ? 'disabled' : ''}
          >${busy ? 'Downloading…' : 'Download this photo'}</button>
          ${images.length > 1 ? `
            <button
              type="button"
              class="btn-download-ghost pdp-dl-btn"
              data-download-all-images
              ${busy ? 'disabled' : ''}
            >Download all ${images.length}</button>
          ` : ''}
        </div>
        <p class="pdp-download-hint">Original resolution · ${IMAGE_FORMATS[format].label}</p>
      </div>`
    : '';

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
        ${downloadBar}
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
    <div class="toc-row">
      <a class="toc-link" href="#cat-${section.id}">
        <span class="toc-num">${padNum(section.id)}</span>
        <span class="toc-name">${escapeHtml(section.name)}</span>
        <span class="toc-dots"></span>
        <span class="toc-count">${section.products.length}</span>
      </a>
      <button
        type="button"
        class="toc-dl"
        data-download-category="${section.id}"
        title="Download ${escapeHtml(section.name)} as PDF"
      >PDF</button>
    </div>
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
        <div class="cat-head-actions">
          <button
            type="button"
            class="cat-select"
            data-select-category="${section.id}"
            ${state.bulkBusy ? 'disabled' : ''}
          >Select all</button>
          <span class="cat-count">${section.products.length} products</span>
        </div>
      </header>
      <div class="grid">
        ${section.products.map(renderCard).join('')}
      </div>
    </section>
  `).join('');

  updateSelectionBar();
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
  updateSelectionBar();
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
    const formatBtn = e.target.closest('[data-image-format]');
    if (formatBtn && state.product) {
      const next = formatBtn.getAttribute('data-image-format');
      if (!IMAGE_FORMATS[next] || next === state.imageFormat) return;
      state.imageFormat = next;
      document.getElementById('view-product').innerHTML =
        renderProductDetail(state.product, state.activeImage);
      return;
    }

    const downloadOne = e.target.closest('[data-download-image]');
    if (downloadOne && state.product) {
      e.preventDefault();
      setImageDownloadBusy(true);
      downloadProductImage(state.product, state.activeImage, state.imageFormat)
        .catch((err) => {
          console.error(err);
          alert(err.message || 'Image download failed');
        })
        .finally(() => {
          setImageDownloadBusy(false);
          if (state.product) {
            document.getElementById('view-product').innerHTML =
              renderProductDetail(state.product, state.activeImage);
          }
        });
      document.getElementById('view-product').innerHTML =
        renderProductDetail(state.product, state.activeImage);
      return;
    }

    const downloadAll = e.target.closest('[data-download-all-images]');
    if (downloadAll && state.product) {
      e.preventDefault();
      setImageDownloadBusy(true);
      downloadAllProductImages(state.product, state.imageFormat)
        .catch((err) => {
          console.error(err);
          alert(err.message || 'Image download failed');
        })
        .finally(() => {
          setImageDownloadBusy(false);
          if (state.product) {
            document.getElementById('view-product').innerHTML =
              renderProductDetail(state.product, state.activeImage);
          }
        });
      document.getElementById('view-product').innerHTML =
        renderProductDetail(state.product, state.activeImage);
      return;
    }

    const btn = e.target.closest('[data-image-index]');
    if (!btn || !state.product) return;
    const index = Number(btn.getAttribute('data-image-index'));
    if (!Number.isFinite(index)) return;
    state.activeImage = index;
    document.getElementById('view-product').innerHTML =
      renderProductDetail(state.product, index);
  });
}

function getVisibleSections() {
  return state.sections
    .map((section) => ({
      ...section,
      products: section.products.filter(filterProduct),
    }))
    .filter((section) => section.products.length > 0);
}

function slugifyFilename(name) {
  return String(name || 'catalogue')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'catalogue';
}

function setPdfBusy(busy, message) {
  const overlay = document.getElementById('pdf-overlay');
  const text = document.getElementById('pdf-overlay-text');
  const fullBtn = document.getElementById('download-full-pdf');
  if (text && message) text.textContent = message;
  if (overlay) overlay.classList.toggle('hidden', !busy);
  if (fullBtn) fullBtn.disabled = busy;
  document.querySelectorAll('.toc-dl').forEach((btn) => {
    btn.disabled = busy;
  });
}

async function downloadPdfFromApi({ category = null, filenameHint = 'catalogue' } = {}) {
  setPdfBusy(true, category ? `Building “${category}” PDF…` : 'Building full catalogue PDF…');

  try {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    const res = await fetch(`/api/v1/catalogue/${BRAND_ID}/pdf${qs}`);
    if (!res.ok) {
      let msg = `PDF failed (${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    const blob = await res.blob();
    if (!blob.size) throw new Error('PDF was empty — try again');

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || `${slugifyFilename(filenameHint)}.pdf`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    setPdfBusy(false);
  }
}

async function downloadCategoryPdf(categoryId) {
  const section = getVisibleSections().find((s) => String(s.id) === String(categoryId));
  if (!section) {
    alert('Category not found.');
    return;
  }
  await downloadPdfFromApi({
    category: section.name,
    filenameHint: `tilting-heads-${section.name}`,
  });
}

async function downloadFullCataloguePdf() {
  await downloadPdfFromApi({ filenameHint: 'tilting-heads-full-catalogue' });
}

function wirePdfDownloads() {
  document.getElementById('download-full-pdf').addEventListener('click', () => {
    downloadFullCataloguePdf().catch((err) => {
      console.error(err);
      alert(err.message || 'PDF download failed');
    });
  });

  document.getElementById('toc').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-download-category]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    downloadCategoryPdf(btn.getAttribute('data-download-category'))
      .catch((err) => {
        console.error(err);
        alert(err.message || 'PDF download failed');
      });
  });
}

function getProductByHandle(handle) {
  for (const section of state.sections) {
    const found = section.products.find((p) => p.handle === handle);
    if (found) return found;
  }
  return null;
}

function getAllVisibleProducts() {
  return getVisibleSections().flatMap((s) => s.products);
}

function countSelectedImages(products) {
  return products.reduce((n, p) => n + productImages(p).length, 0);
}

function sanitizePathPart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

function productZipFolderName(product) {
  const sku = sanitizePathPart(product.sku || 'NO-SKU');
  const title = sanitizePathPart(product.title || product.handle || 'product');
  return `${sku}_${title}`;
}

function toggleProductSelection(handle, checked) {
  const product = getProductByHandle(handle);
  if (!product || !productImages(product).length) return;
  if (checked) state.selectedHandles.add(handle);
  else state.selectedHandles.delete(handle);

  const card = [...document.querySelectorAll('.card')]
    .find((el) => el.getAttribute('data-handle') === handle);
  if (card) {
    card.classList.toggle('is-selected', checked);
    const input = card.querySelector('[data-select-product]');
    if (input) input.checked = checked;
  }
  updateSelectionBar();
}

function selectProducts(products) {
  for (const p of products) {
    if (productImages(p).length) state.selectedHandles.add(p.handle);
  }
  if (parseRoute().name === 'catalogue') renderCatalogue();
  else updateSelectionBar();
}

function clearSelection() {
  state.selectedHandles.clear();
  if (parseRoute().name === 'catalogue') renderCatalogue();
  else updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  if (!bar) return;

  const onCatalogue = parseRoute().name === 'catalogue';
  const selected = [...state.selectedHandles]
    .map(getProductByHandle)
    .filter(Boolean);
  const count = selected.length;
  const imageCount = countSelectedImages(selected);

  bar.classList.toggle('hidden', !onCatalogue || count === 0);

  const countEl = document.getElementById('selection-count');
  const hintEl = document.getElementById('selection-hint');
  const progressEl = document.getElementById('selection-progress');
  if (countEl) {
    countEl.textContent = `${count} product${count === 1 ? '' : 's'} selected`;
  }
  if (hintEl) {
    hintEl.textContent = imageCount
      ? `· ${imageCount} image${imageCount === 1 ? '' : 's'}`
      : '';
    if (count > BULK_WARN_PRODUCTS) {
      hintEl.textContent += ` · large download may take a few minutes`;
    }
  }
  if (progressEl) progressEl.textContent = state.bulkProgress || '';

  document.querySelectorAll('[data-bulk-format]').forEach((btn) => {
    const key = btn.getAttribute('data-bulk-format');
    btn.classList.toggle('is-active', key === state.bulkFormat);
    btn.disabled = state.bulkBusy;
  });

  const downloadBtn = document.getElementById('download-selected-images');
  const clearBtn = document.getElementById('clear-selection');
  const selectAllBtn = document.getElementById('select-all-visible');
  if (downloadBtn) {
    downloadBtn.disabled = state.bulkBusy || count === 0;
    downloadBtn.textContent = state.bulkBusy
      ? 'Preparing zip…'
      : `Download images (${IMAGE_FORMATS[state.bulkFormat].label})`;
  }
  if (clearBtn) clearBtn.disabled = state.bulkBusy;
  if (selectAllBtn) selectAllBtn.disabled = state.bulkBusy;

  document.body.classList.toggle('has-selection-bar', onCatalogue && count > 0);
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

async function downloadSelectedImagesZip() {
  if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
    throw new Error('Zip libraries still loading — wait a second and try again');
  }

  const selected = [...state.selectedHandles]
    .map(getProductByHandle)
    .filter((p) => p && productImages(p).length);

  if (!selected.length) {
    throw new Error('No products with images selected');
  }

  const formatKey = IMAGE_FORMATS[state.bulkFormat] ? state.bulkFormat : 'jpeg';
  const imageJobs = [];
  for (const product of selected) {
    const folder = productZipFolderName(product);
    const images = productImages(product);
    images.forEach((img, i) => {
      imageJobs.push({
        product,
        folder,
        url: img.url,
        filename: `${folder}_${i + 1}.${IMAGE_FORMATS[formatKey].ext}`,
      });
    });
  }

  if (selected.length > BULK_WARN_PRODUCTS) {
    const ok = window.confirm(
      `Downloading ${selected.length} products (~${imageJobs.length} images) — this may take a few minutes. Continue?`,
    );
    if (!ok) return;
  }

  state.bulkBusy = true;
  state.bulkProgress = `Downloading 0/${imageJobs.length} images…`;
  updateSelectionBar();
  if (parseRoute().name === 'catalogue') renderCatalogue();

  try {
    const zip = new JSZip();
    const root = `TiltingHeads_Images_${new Date().toISOString().slice(0, 10)}`;
    let done = 0;

    await mapPool(imageJobs, BULK_CONCURRENCY, async (job) => {
      const blob = await convertImageBlob(job.url, formatKey);
      zip.file(`${root}/${job.folder}/${job.filename}`, blob);
      done += 1;
      state.bulkProgress = `Downloading ${done}/${imageJobs.length} images…`;
      const progressEl = document.getElementById('selection-progress');
      if (progressEl) progressEl.textContent = state.bulkProgress;
    });

    state.bulkProgress = 'Building zip file…';
    updateSelectionBar();

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    saveAs(zipBlob, `${root}.zip`);
    state.bulkProgress = `Done — ${imageJobs.length} images zipped`;
  } finally {
    state.bulkBusy = false;
    updateSelectionBar();
    if (parseRoute().name === 'catalogue') renderCatalogue();
    setTimeout(() => {
      state.bulkProgress = '';
      updateSelectionBar();
    }, 2500);
  }
}

function wireBulkSelection() {
  const root = document.getElementById('catalogue-root');
  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-select-product]');
    if (!input) return;
    toggleProductSelection(input.getAttribute('data-select-product'), input.checked);
  });

  root.addEventListener('click', (e) => {
    const selectCat = e.target.closest('[data-select-category]');
    if (!selectCat) return;
    e.preventDefault();
    const section = getVisibleSections().find(
      (s) => String(s.id) === String(selectCat.getAttribute('data-select-category')),
    );
    if (!section) return;
    selectProducts(section.products);
  });

  document.getElementById('select-all-visible').addEventListener('click', () => {
    selectProducts(getAllVisibleProducts());
  });

  document.getElementById('clear-selection').addEventListener('click', () => {
    clearSelection();
  });

  document.getElementById('download-selected-images').addEventListener('click', () => {
    downloadSelectedImagesZip().catch((err) => {
      console.error(err);
      alert(err.message || 'Bulk image download failed');
      state.bulkBusy = false;
      state.bulkProgress = '';
      updateSelectionBar();
      if (parseRoute().name === 'catalogue') renderCatalogue();
    });
  });

  document.querySelector('.selection-format')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bulk-format]');
    if (!btn || state.bulkBusy) return;
    const next = btn.getAttribute('data-bulk-format');
    if (!IMAGE_FORMATS[next]) return;
    state.bulkFormat = next;
    updateSelectionBar();
  });
}

async function boot() {
  wireFilters();
  wireProductGallery();
  wirePdfDownloads();
  wireBulkSelection();
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
