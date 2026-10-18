import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = join(projectRoot, 'dist');
const siteUrl = (process.env.SITE_URL || 'https://wenappliances.vercel.app').replace(/\/$/, '');
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

const parseImages = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
  } catch {
    return [value];
  }
};

const absoluteImageUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${siteUrl}${value}`;
  return null;
};

const plainText = (value) => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncate = (value, maxLength) => {
  const text = plainText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
};

const productDescription = (product) => truncate(
  product.description,
  155
) || `${product.name || 'Appliance'} from WenAppliances. Check current pricing, availability, delivery options, and product details.`;

const replaceTag = (html, pattern, replacement) => html.replace(pattern, replacement);

const renderHead = ({ template, title, description, canonical, image, imageAlt, robots, type, jsonLd }) => {
  let html = template;
  const tags = {
    description: `<meta name="description" content="${escapeHtml(description)}" />`,
    robots: `<meta name="robots" content="${escapeHtml(robots)}" />`,
    canonical: `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    ogType: `<meta property="og:type" content="${escapeHtml(type)}" />`,
    ogUrl: `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    ogTitle: `<meta property="og:title" content="${escapeHtml(title)}" />`,
    ogDescription: `<meta property="og:description" content="${escapeHtml(description)}" />`,
    ogImage: `<meta property="og:image" content="${escapeHtml(image)}" />`,
    ogImageAlt: `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
    twitterTitle: `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    twitterDescription: `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    twitterImage: `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    title: `<title>${escapeHtml(title)}</title>`,
    jsonLd: `<script type="application/ld+json" id="wen-base-jsonld">${safeJson(jsonLd)}</script>`
  };

  html = replaceTag(html, /<meta name="description"[^>]*>/i, tags.description);
  html = replaceTag(html, /<meta name="robots"[^>]*>/i, tags.robots);
  html = replaceTag(html, /<link rel="canonical"[^>]*>/i, tags.canonical);
  html = replaceTag(html, /<meta property="og:type"[^>]*>/i, tags.ogType);
  html = replaceTag(html, /<meta property="og:url"[^>]*>/i, tags.ogUrl);
  html = replaceTag(html, /<meta property="og:title"[^>]*>/i, tags.ogTitle);
  html = replaceTag(html, /<meta property="og:description"[^>]*>/i, tags.ogDescription);
  html = replaceTag(html, /<meta property="og:image"[^>]*>/i, tags.ogImage);
  html = replaceTag(html, /<meta property="og:image:alt"[^>]*>/i, tags.ogImageAlt);
  html = replaceTag(html, /<meta name="twitter:title"[^>]*>/i, tags.twitterTitle);
  html = replaceTag(html, /<meta name="twitter:description"[^>]*>/i, tags.twitterDescription);
  html = replaceTag(html, /<meta name="twitter:image"[^>]*>/i, tags.twitterImage);
  html = replaceTag(html, /<title>[\s\S]*?<\/title>/i, tags.title);
  html = replaceTag(html, /<script type="application\/ld\+json" id="wen-base-jsonld">[\s\S]*?<\/script>/i, tags.jsonLd);
  return html;
};

const baseGraph = {
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: 'WenAppliances',
  url: `${siteUrl}/`,
  logo: `${siteUrl}/wen-icon.png`
};

const websiteGraph = {
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: 'WenAppliances',
  url: `${siteUrl}/`,
  publisher: { '@id': `${siteUrl}/#organization` }
};

const buildProductsPage = (template, products) => {
  const itemListElement = products.map((product, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: product.name || 'Appliance',
    url: `${siteUrl}/product/${encodeURIComponent(String(product.id))}`
  }));

  return renderHead({
    template,
    title: 'Shop Appliances | WenAppliances',
    description: 'Browse available refrigerators, washers, dryers, and other home appliances from WenAppliances.',
    canonical: `${siteUrl}/products`,
    image: `${siteUrl}/wen-icon.png`,
    imageAlt: 'WenAppliances logo',
    robots: 'index, follow',
    type: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        baseGraph,
        websiteGraph,
        { '@type': 'CollectionPage', '@id': `${siteUrl}/products#collection`, name: 'Shop Appliances', url: `${siteUrl}/products`, isPartOf: { '@id': `${siteUrl}/#website` }, mainEntity: { '@type': 'ItemList', itemListElement } }
      ]
    }
  });
};

const buildTermsPage = (template) => renderHead({
  template,
  title: 'Terms and Conditions | Wen Appliances',
  description: 'Read the terms for using the Wen Appliances website, placing orders, delivery, pickup and product support.',
  canonical: `${siteUrl}/terms`,
  image: `${siteUrl}/wen-icon.png`,
  imageAlt: 'Wen Appliances logo',
  robots: 'index, follow',
  type: 'website',
  jsonLd: {
    '@context': 'https://schema.org',
    '@graph': [
      baseGraph,
      websiteGraph,
      { '@type': 'WebPage', '@id': `${siteUrl}/terms#webpage`, name: 'Terms and Conditions', url: `${siteUrl}/terms`, isPartOf: { '@id': `${siteUrl}/#website` } }
    ]
  }
});

const buildProductPage = (template, product) => {
  const productId = encodeURIComponent(String(product.id));
  const canonical = `${siteUrl}/product/${productId}`;
  const name = plainText(product.name) || 'Appliance';
  const description = productDescription(product);
  const images = parseImages(product.images).map(absoluteImageUrl).filter(Boolean);
  const image = images[0] || `${siteUrl}/wen-icon.png`;
  const stock = Number(product.stock || 0);
  const productJsonLd = {
    '@type': 'Product',
    name,
    description,
    image: images.length ? images : [image],
    category: product.category || undefined,
    brand: { '@type': 'Brand', name: 'WenAppliances' },
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'USD',
      price: Number.isFinite(Number(product.price)) ? Number(product.price).toFixed(2) : '0.00',
      availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
    }
  };

  return renderHead({
    template,
    title: `${truncate(name, 56)} | WenAppliances`,
    description,
    canonical,
    image,
    imageAlt: `${name} from WenAppliances`,
    robots: 'index, follow',
    type: 'product',
    jsonLd: { '@context': 'https://schema.org', '@graph': [baseGraph, websiteGraph, productJsonLd] }
  });
};

const fetchProducts = async () => {
  if (!supabaseUrl || !supabaseKey) return [];

  const response = await fetch(`${supabaseUrl}/rest/v1/products?select=id,name,category,price,stock,images,description&order=created_at.desc`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  });
  if (!response.ok) throw new Error(`Product lookup returned HTTP ${response.status}.`);
  const products = await response.json();
  return Array.isArray(products) ? products.filter((product) => product?.id) : [];
};

const templatePath = join(distRoot, 'index.html');
if (!readFileSync(templatePath, 'utf8')) throw new Error('The storefront index.html is empty.');

try {
  const template = readFileSync(templatePath, 'utf8');
  mkdirSync(join(distRoot, 'terms'), { recursive: true });
  writeFileSync(join(distRoot, 'terms', 'index.html'), buildTermsPage(template), 'utf8');

  const products = await fetchProducts();

  mkdirSync(join(distRoot, 'products'), { recursive: true });
  writeFileSync(join(distRoot, 'products', 'index.html'), buildProductsPage(template, products), 'utf8');

  for (const product of products) {
    const routeSegment = encodeURIComponent(String(product.id));
    const outputPath = join(distRoot, 'product', routeSegment, 'index.html');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, buildProductPage(template, product), 'utf8');
  }

  console.log(`SEO pages generated for ${products.length} public product${products.length === 1 ? '' : 's'}.`);
} catch (error) {
  // A transient catalog/API failure must not prevent the storefront bundle from deploying.
  console.warn(`SEO page generation skipped: ${error.message}`);
}
