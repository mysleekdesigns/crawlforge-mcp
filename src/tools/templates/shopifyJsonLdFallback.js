/**
 * shopifyJsonLdFallback.js — a Shopify product from the storefront's own
 * JSON-LD when /products/<handle>.json is refused.
 *
 * gymshark.com answers the JSON endpoint with 403 while the product page is
 * public and carries a schema.org ProductGroup whose hasVariant Products each
 * carry an Offer (R18, 2026-09-04). allbirds.com redirected a retired handle
 * to a collection page, so the .json URL was a 404 with no product behind it.
 * Both used to surface as a bare "HTTP 403/404" from the template. This reads
 * the page instead and says what it fell back to; per-variant inventory is not
 * in JSON-LD, so `available` is the offer's availability and variants carry
 * no stock count.
 */

import { load } from 'cheerio';

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenLd(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => flattenLd(n, out)); return out; }
  out.push(node);
  if (node['@graph']) flattenLd(node['@graph'], out);
  return out;
}

const typed = (re) => (node) => asArray(node?.['@type']).some((t) => re.test(String(t)));
const isProduct = typed(/^product$/i);
const isProductGroup = typed(/^productgroup$/i);

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  return n == null ? null : n.toFixed(2);
}

// Gymshark writes its name as "Arrival 5&quot; Shorts" inside the JSON.
function decodeEntities(value) {
  if (typeof value !== 'string') return null;
  const text = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(value) ? load(`<x>${value}</x>`)('x').text() : value;
  return text.replace(/\s+/g, ' ').trim() || null;
}

function availabilityOf(offer) {
  const a = String(offer?.availability || '');
  if (!a) return null;
  if (/InStock|PreOrder|BackOrder|LimitedAvailability|OnlineOnly/i.test(a)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(a)) return false;
  return null;
}

/** Offers of a node, an AggregateOffer's own list included. */
function offersOf(node) {
  return asArray(node?.offers)
    .flatMap((o) => (o && typed(/AggregateOffer/i)(o) && o.offers ? asArray(o.offers) : [o]))
    .filter(Boolean);
}

function offerPrice(offer) {
  return toNumber(offer.price ?? offer.lowPrice);
}

/**
 * @param {string} html - the product page
 * @param {string} url - the product page URL
 * @returns {{ found: boolean, data?: object, reason?: string }}
 */
export function shopifyProductFromJsonLd(html, url) {
  const $ = load(html || '');
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try { flattenLd(JSON.parse(raw), nodes); } catch { /* one bad block does not lose the rest */ }
  });
  const product = nodes.find(isProductGroup) || nodes.find(isProduct);
  if (!product) {
    return {
      found: false,
      reason: `${url} carries no schema.org Product JSON-LD` +
        (/\/collections\//.test(url) ? ' — the product URL redirected to a collection page, so the product handle no longer exists' : '')
    };
  }

  // A ProductGroup (or a Product with hasVariant) prices each variant on the
  // variant; a plain Product prices its offers directly.
  const variantNodes = asArray(product.hasVariant).filter(isProduct);
  const variants = variantNodes.length > 0
    ? variantNodes.map((v) => {
      const offers = offersOf(v);
      const prices = offers.map(offerPrice).filter((n) => n != null);
      const availabilities = offers.map(availabilityOf).filter((a) => a !== null);
      const options = ['size', 'color', 'material', 'pattern'].map((k) => decodeEntities(v[k])).filter(Boolean);
      return {
        id: v.sku || v.mpn || v.productID || null,
        title: decodeEntities(v.name) || options.join(' / ') || v.sku || null,
        price: money(prices.length ? Math.min(...prices) : null),
        compare_at_price: null,
        sku: v.sku || null,
        available: availabilities.length ? availabilities.some(Boolean) : null,
        inventory_quantity: null,
        options
      };
    })
    : offersOf(product).map((o) => ({
      id: o.sku || o.mpn || null,
      title: decodeEntities(o.name) || o.sku || null,
      price: money(offerPrice(o)),
      compare_at_price: null,
      sku: o.sku || null,
      available: availabilityOf(o),
      inventory_quantity: null,
      options: []
    }));

  const allOffers = variantNodes.length > 0 ? variantNodes.flatMap(offersOf) : offersOf(product);
  const prices = allOffers.map(offerPrice).filter((n) => n != null);
  const highs = allOffers.map((o) => toNumber(o.highPrice)).filter((n) => n != null);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices, ...highs) : (highs.length ? Math.max(...highs) : null);
  const currency = allOffers.map((o) => o.priceCurrency).find(Boolean) || null;
  const availabilities = allOffers.map(availabilityOf).filter((v) => v !== null);
  const available = availabilities.length ? availabilities.some(Boolean) : null;

  let handle = null;
  try { handle = (new URL(url).pathname.match(/\/products\/([^/?#]+)/) || [])[1] || null; } catch { /* keep null */ }

  const brand = product.brand && typeof product.brand === 'object' ? product.brand.name : product.brand;
  const images = asArray(product.image).map((i) => (i && typeof i === 'object' ? i.url || i.contentUrl : i)).filter(Boolean);
  const options = asArray(product.variesBy).map((v) => String(v).split('/').pop().toLowerCase()).filter(Boolean);

  const data = {
    title: decodeEntities(product.name),
    vendor: decodeEntities(brand),
    product_type: decodeEntities(product.category),
    handle,
    product_id: product.productGroupID || product.productID || product.sku || null,
    price: money(priceMin),
    compare_at_price: null,
    on_sale: null,
    currency,
    price_min: money(priceMin),
    price_max: money(priceMax),
    available,
    variants,
    options,
    description: decodeEntities(product.description),
    images,
    url: product.url || url,
    source: 'json-ld'
  };
  return { found: true, data };
}
