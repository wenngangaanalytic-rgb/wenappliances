import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { formatMoney } from './utils/format';

const BASE_CATEGORIES = [
  'Refrigerators',
  'Washers',
  'Dryers',
  'Washer & Dryer',
  'Ovens',
  'Microwaves',
  'Dishwashers',
  'TVs',
  'Other'
];

export default function ApplianceCatalog({
  products = [],
  loading = false,
  error = '',
  onRetry = () => {},
  onProductClick,
  searchQuery = '',
  onSearchQueryChange = () => {},
  activeCategory = 'All',
  onActiveCategoryChange = () => {}
}) {
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const categories = useMemo(() => {
    const databaseCategories = products.map((product) => product.category).filter(Boolean);
    return ['All', ...new Set([...BASE_CATEGORIES, ...databaseCategories])];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const minimum = minPrice === '' ? null : Number(minPrice);
    const maximum = maxPrice === '' ? null : Number(maxPrice);

    return products.filter((product) => {
      const name = String(product.name ?? '').toLowerCase();
      const category = String(product.category ?? '').toLowerCase();
      const description = String(product.description ?? '').toLowerCase();
      const price = Number(product.price ?? 0);
      const matchesSearch = !normalizedSearch
        || name.includes(normalizedSearch)
        || category.includes(normalizedSearch)
        || description.includes(normalizedSearch);
      const matchesCategory = activeCategory === 'All' || product.category === activeCategory;
      const matchesMinimum = minimum === null || price >= minimum;
      const matchesMaximum = maximum === null || price <= maximum;

      return matchesSearch && matchesCategory && matchesMinimum && matchesMaximum;
    });
  }, [products, searchQuery, activeCategory, minPrice, maxPrice]);

  const clearFilters = () => {
    onSearchQueryChange('');
    onActiveCategoryChange('All');
    setMinPrice('');
    setMaxPrice('');
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || activeCategory !== 'All' || minPrice || maxPrice);

  return (
    <section className="store-catalog mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8" aria-labelledby="catalog-title">
      <div className="mb-8">
        <p className="store-eyebrow mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Shop</p>
        <h1 id="catalog-title" className="store-section-title text-3xl font-semibold tracking-tight sm:text-4xl">Appliances</h1>
        <p className="store-muted mt-2 max-w-2xl">Find available products by name, category or price. Open a product to see details or ask us a question.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8">
        <aside className="store-catalog-filter h-fit rounded-xl p-4 sm:p-5 lg:sticky lg:top-24" aria-labelledby="catalog-filter-title">
          <div className="mb-5 flex items-center gap-2">
            <SlidersHorizontal className="store-eyebrow h-4 w-4" aria-hidden="true" />
            <h2 id="catalog-filter-title" className="text-sm font-semibold">Filter appliances</h2>
          </div>

          <div className="mb-5">
            <label htmlFor="product-search" className="store-field-label mb-2 block text-sm font-medium">Search</label>
            <div className="relative">
              <Search className="store-field-icon absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
              <input
                id="product-search"
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Name or feature"
                className="store-input w-full rounded-lg py-2.5 pl-9 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="mb-5">
            <label htmlFor="category-filter" className="store-field-label mb-2 block text-sm font-medium">Category</label>
            <select
              id="category-filter"
              value={activeCategory}
              onChange={(event) => onActiveCategoryChange(event.target.value)}
              className="store-input w-full rounded-lg px-3 py-2.5 text-sm"
            >
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>

          <fieldset>
            <legend className="store-field-label mb-2 text-sm font-medium">Price range (USD)</legend>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <label className="sr-only" htmlFor="minimum-price">Minimum price</label>
              <input id="minimum-price" type="number" min="0" step="1" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Min" className="store-input min-w-0 rounded-lg px-3 py-2.5 text-sm" />
              <span className="store-muted" aria-hidden="true">to</span>
              <label className="sr-only" htmlFor="maximum-price">Maximum price</label>
              <input id="maximum-price" type="number" min="0" step="1" inputMode="decimal" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Max" className="store-input min-w-0 rounded-lg px-3 py-2.5 text-sm" />
            </div>
          </fieldset>

          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="store-text-link mt-4 min-h-11 text-sm font-medium">
              Clear filters
            </button>
          )}
        </aside>

        <div className="min-w-0">
          {!loading && !error && (
            <p className="store-muted mb-4 text-sm" aria-live="polite" aria-atomic="true">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'appliance' : 'appliances'}
            </p>
          )}

          {loading && (
            <div className="store-product-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading appliances">
              {Array.from({ length: 6 }, (_, index) => (
                <article key={index} className="store-product-card store-product-card--skeleton" aria-hidden="true">
                  <div className="store-skeleton store-product-card__media" />
                  <div className="space-y-3 p-4">
                    <div className="store-skeleton h-3 w-1/3 rounded" />
                    <div className="store-skeleton h-5 w-4/5 rounded" />
                    <div className="store-skeleton h-10 w-full rounded-lg" />
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="store-empty-state px-6 py-12 text-center" role="alert">
              <h2 className="text-lg font-semibold">We couldn’t load the catalog</h2>
              <p className="store-muted mt-2">Check your connection and try again.</p>
              <button type="button" onClick={onRetry} className="store-button-primary mt-5 px-5">Try again</button>
            </div>
          )}

          {!loading && !error && filteredProducts.length === 0 && (
            <div className="store-empty-state px-6 py-12 text-center">
              <h2 className="text-lg font-semibold">No appliances match those filters</h2>
              <p className="store-muted mt-2">Try another search, category or price range.</p>
              <button type="button" onClick={clearFilters} className="store-button-secondary mt-5 px-5">Clear filters</button>
            </div>
          )}

          {!loading && !error && filteredProducts.length > 0 && (
            <div className="store-product-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((product) => {
                const imageUrl = product.images?.[0] || '';
                const inStock = Number(product.stock ?? 0) > 0;

                return (
                  <article key={product.id} className="store-product-card group flex h-full flex-col overflow-hidden">
                    <button type="button" onClick={() => onProductClick?.(product.id)} className="store-product-card__view text-left" aria-label={`View details for ${product.name}`}>
                      <div className="store-product-card__media product-photo-surface relative aspect-[4/3] overflow-hidden">
                        {imageUrl ? (
                          <img src={imageUrl} alt={product.name} loading="lazy" decoding="async" className="store-product-card__image product-photo h-full w-full object-cover" />
                        ) : (
                          <div className="store-image-placeholder flex h-full w-full items-center justify-center text-sm">Image coming soon</div>
                        )}
                      </div>
                      <div className="px-4 pt-4">
                        <p className="store-eyebrow text-xs font-semibold uppercase tracking-wider">{product.category}</p>
                        <h2 className="store-product-card__title mt-1 line-clamp-2 text-base font-semibold">{product.name}</h2>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="store-product-card__price text-lg font-semibold">{formatMoney(product.price)}</p>
                          <span className={`store-stock-badge ${inStock ? '' : 'store-stock-badge--out'}`}>
                            {inStock ? 'In stock' : 'Out of stock'}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="mt-auto px-4 pb-4 pt-4">
                      <button type="button" onClick={() => onProductClick?.(product.id)} className="store-button-secondary w-full px-3">View product</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
