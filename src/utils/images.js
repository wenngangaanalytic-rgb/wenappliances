export const parseImageList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
  } catch {
    return [value];
  }
};

export const normalizeProduct = (product = {}) => {
  const storedImages = parseImageList(product.images);
  const image = product.image || product.image_url || product.imageUrl || storedImages[0] || '';
  const gallery = parseImageList(product.gallery);
  const allImages = [...new Set([image, ...storedImages, ...gallery].filter(Boolean))];
  const stock = Number(product.stock ?? 0);

  return {
    ...product,
    name: product.name || 'Unnamed appliance',
    sku: product.sku || '—',
    category: product.category || 'Other',
    description: product.description || '',
    price: Number(product.price ?? 0),
    cost: Number(product.cost ?? 0),
    stock,
    status: String(product.status || (stock > 0 ? 'PUBLISHED' : 'OUT_OF_STOCK')).toUpperCase(),
    image,
    images: allImages,
    gallery: allImages
  };
};

export const getProductImages = (product) => {
  const normalized = normalizeProduct(product);
  return [...new Set([normalized.image, ...normalized.gallery].filter(Boolean))];
};

export const getWenAppliancesStoragePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;

  const marker = '/storage/v1/object/public/Wenappliances/';
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return null;

  const path = value.slice(markerIndex + marker.length).split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};
