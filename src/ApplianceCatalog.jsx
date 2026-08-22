import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const BASE_CATEGORIES = [
  'Refrigerators',
  'Washers',
  'Dryers',
  'Ovens',
  'Microwaves',
  'Dishwashers',
  'TVs',
  'Other'
];

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

export default function ApplianceCatalog({ onProductClick }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchProducts() {
      setLoading(true);
      setError('');

      const { data, error: fetchError } = await supabase
        .from('products')
        .select('*');

      if (!isMounted) return;

      if (fetchError) {
        setProducts([]);
        setError(fetchError.message);
      } else {
        setProducts(data ?? []);
      }

      setLoading(false);
    }

    fetchProducts();

    return () => {
      isMounted = false;
    };
  }, [retryCount]);

  const categories = useMemo(() => {
    const databaseCategories = products
      .map((product) => product.category)
      .filter(Boolean);

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
      const matchesCategory = activeCategory === 'All'
        || product.category === activeCategory;
      const matchesMinimum = minimum === null || price >= minimum;
      const matchesMaximum = maximum === null || price <= maximum;

      return matchesSearch && matchesCategory && matchesMinimum && matchesMaximum;
    });
  }, [products, searchQuery, activeCategory, minPrice, maxPrice]);

  const clearFilters = () => {
    setSearchQuery('');
    setActiveCategory('All');
    setMinPrice('');
    setMaxPrice('');
  };

  return (
    <section className="motion-fade-up mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-labelledby="catalog-title">
      <div className="mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#9C6644]">WenAppliances</p>
        <h1 id="catalog-title" className="text-3xl font-bold tracking-tight text-[#111214]">Appliance Catalog</h1>
        <p className="mt-2 text-[#4A5568]">Browse appliances currently available in our live catalog.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="self-start rounded-xl border border-[#E5E4E0] bg-white p-5 shadow-sm lg:sticky lg:top-6">
          <div className="mb-5">
            <label htmlFor="product-search" className="mb-2 block text-sm font-semibold text-[#111214]">Search</label>
            <input
              id="product-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search appliances"
              className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
            />
          </div>

          <div className="mb-5">
            <label htmlFor="category-filter" className="mb-2 block text-sm font-semibold text-[#111214]">Category</label>
            <select
              id="category-filter"
              value={activeCategory}
              onChange={(event) => setActiveCategory(event.target.value)}
              className="w-full rounded-lg border border-[#E5E4E0] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
            >
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-[#111214]">Price range</legend>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                placeholder="Min"
                aria-label="Minimum price"
                className="w-full min-w-0 rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
              />
              <span className="text-[#858884]">–</span>
              <input
                type="number"
                min="0"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                placeholder="Max"
                aria-label="Maximum price"
                className="w-full min-w-0 rounded-lg border border-[#E5E4E0] px-3 py-2 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
              />
            </div>
          </fieldset>

          <button type="button" onClick={clearFilters} className="mt-5 text-sm font-medium text-[#9C6644] underline-offset-4 hover:underline">
            Clear filters
          </button>
        </aside>

        <div className="min-w-0">
          {loading && (
            <div className="rounded-xl border border-[#E5E4E0] bg-white px-6 py-16 text-center text-[#4A5568]">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-[#E5E4E0] border-t-[#9C6644]" />
              Loading appliances...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center text-red-800" role="alert">
              <p>Unable to load appliances: {error}</p>
              <button type="button" onClick={() => setRetryCount((count) => count + 1)} className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900">
                Try again
              </button>
            </div>
          )}

          {!loading && !error && filteredProducts.length === 0 && (
            <div className="rounded-xl border border-[#E5E4E0] bg-white px-6 py-16 text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-[#EAE8E1]" />
              <h2 className="text-xl font-semibold text-[#111214]">No appliances found</h2>
              <p className="mt-2 text-[#4A5568]">Try adjusting your search or filters.</p>
              <button type="button" onClick={clearFilters} className="mt-5 rounded-lg bg-[#111214] px-4 py-2 text-sm font-semibold text-white hover:bg-[#24272A]">
                Clear filters
              </button>
            </div>
          )}

          {!loading && !error && filteredProducts.length > 0 && (
            <div className="motion-stagger grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((product) => {
                const imageUrl = Array.isArray(product.images) ? product.images[0] : '';
                const inStock = Number(product.stock ?? 0) > 0;

                return (
                  <article key={product.id} className="motion-card group overflow-hidden rounded-xl border border-[#E5E4E0] bg-white shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all">
                    <button type="button" onClick={() => onProductClick?.(product.id)} className="block w-full text-left" aria-label={`View details for ${product.name || 'appliance'}`}>
                    <div className="product-photo-surface aspect-[4/3] overflow-hidden bg-[#D1D5DB]">
                      {imageUrl ? (
                        <img src={imageUrl} alt={product.name || 'Appliance'} className="product-photo h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-medium text-gray-500">No image available</div>
                      )}
                    </div>

                    <div className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#858884]">{product.category || 'Other'}</p>
                      <h2 className="mt-1 line-clamp-2 min-h-12 text-lg font-semibold text-[#111214]">{product.name || 'Unnamed appliance'}</h2>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="text-xl font-bold text-[#111214]">{moneyFormatter.format(Number(product.price ?? 0))}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${inStock ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {inStock ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </div>
                    </div>
                    </button>
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
