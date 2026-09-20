import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const siteUrl = (process.env.SITE_URL || 'https://wenappliances.net').replace(/\/$/, '');
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const urls = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/products', changefreq: 'daily', priority: '0.9' }
];

if (supabaseUrl && supabaseKey) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/products?select=id&order=created_at.desc`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });

    if (response.ok) {
      const products = await response.json();
      for (const product of Array.isArray(products) ? products : []) {
        if (!product?.id) continue;
        urls.push({
          path: `/product/${encodeURIComponent(String(product.id))}`,
          changefreq: 'daily',
          priority: '0.8'
        });
      }
    } else {
      console.warn(`Sitemap product lookup skipped with HTTP ${response.status}.`);
    }
  } catch (error) {
    console.warn(`Sitemap product lookup skipped: ${error.message}`);
  }
}

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(({ path, changefreq, priority }) => [
    '  <url>',
    `    <loc>${escapeXml(`${siteUrl}${path}`)}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>'
  ].join('\n')),
  '</urlset>',
  ''
].join('\n');

writeFileSync(join(projectRoot, 'public', 'sitemap.xml'), sitemap, 'utf8');
console.log(`Sitemap generated with ${urls.length} public URL${urls.length === 1 ? '' : 's'}.`);
