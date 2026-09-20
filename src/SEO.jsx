import { useEffect } from 'react';

export const STOREFRONT_SITE_URL = 'https://wenappliances.vercel.app';
export const STOREFRONT_DEFAULT_IMAGE = `${STOREFRONT_SITE_URL}/wen-icon.png`;

const upsertMeta = (attribute, key, content) => {
  if (!content) return;

  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute('content', content);
};

const upsertLink = (rel, href) => {
  let element = document.head.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }

  element.setAttribute('href', href);
};

// Text inserted into JSON-LD must not be able to close the script element.
const safeJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

export default function SEO({
  title,
  description,
  canonicalPath = '/',
  robots = 'index, follow',
  image = STOREFRONT_DEFAULT_IMAGE,
  imageAlt = 'WenAppliances logo',
  type = 'website',
  jsonLd = null,
  siteUrl = STOREFRONT_SITE_URL
}) {
  useEffect(() => {
    const canonicalUrl = canonicalPath.startsWith('http')
      ? canonicalPath
      : `${siteUrl}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}`;

    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', robots);
    upsertMeta('name', 'author', 'WenAppliances');
    upsertMeta('property', 'og:site_name', 'WenAppliances');
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:image', image);
    upsertMeta('property', 'og:image:alt', imageAlt);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', image);
    upsertLink('canonical', canonicalUrl);

    const existingJsonLd = document.getElementById('wen-route-jsonld');
    if (jsonLd) {
      const script = existingJsonLd || document.createElement('script');
      script.id = 'wen-route-jsonld';
      script.type = 'application/ld+json';
      script.textContent = safeJson(jsonLd);
      if (!existingJsonLd) document.head.appendChild(script);
    } else if (existingJsonLd) {
      existingJsonLd.remove();
    }
  }, [canonicalPath, description, image, imageAlt, jsonLd, robots, siteUrl, title, type]);

  return null;
}
