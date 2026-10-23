import React, { lazy, Suspense, useState, useEffect, useContext, useMemo, useReducer, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { 
  ShoppingCart, Search, Menu, X, User, ChevronRight, 
  Package, LayoutDashboard, Settings, LogOut, 
  TrendingUp, Users, DollarSign, Edit, Trash2, Plus,
  ShieldCheck, AlertTriangle, CheckCircle2, Lock, Eye, EyeOff,
  Printer, Download, ImagePlus, Moon, Sun, GripVertical, Star, MessagesSquare, ExternalLink
} from 'lucide-react';
import { supabase } from './supabaseClient';
const SecureAdminLogin = lazy(() => import('./AdminLogin'));
const SecureProductEditor = lazy(() => import('./ProductEditor'));
import LiveApplianceCatalog from './ApplianceCatalog';
const Checkout = lazy(() => import('./Checkout'));
const TermsAndConditions = lazy(() => import('./TermsAndConditions'));
const OrderTracking = lazy(() => import('./OrderTracking'));
const SupabaseAdminOrders = lazy(() => import('./AdminOrders'));
const SupabaseAdminMembers = lazy(() => import('./AdminMembers'));
const AdminTools = lazy(() => import('./AdminTools'));
const AdminProductChat = lazy(() => import('./AdminProductChat'));
import AccountMenu from './AccountMenu';
const ResetPassword = lazy(() => import('./ResetPassword'));
const ProductChatWidget = lazy(() => import('./ProductChatWidget'));
import { ChatNotificationBell, ChatNotificationProvider } from './ChatNotifications';
import PresenceTracker from './PresenceTracker';
import OrderNotificationPrompt from './OrderNotificationPrompt';
import { AdminOrderNotificationWatcher, CustomerOrderNotificationWatcher } from './OrderNotificationWatchers';
import { rememberOrderForNotifications } from './browserNotifications';
import PushNotificationRegistration from './PushNotificationRegistration';
import NativeAdminController from './NativeAdminController';
import PullToRefresh from './PullToRefresh';
import { triggerLightHaptic, triggerSuccessHaptic } from './nativeAdmin';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from './businessInfo';
import SEO, { STOREFRONT_DEFAULT_IMAGE, STOREFRONT_SITE_URL } from './SEO.jsx';
import {
  ADMIN_PORTAL_ROLE_MESSAGE,
  CUSTOMER_PORTAL_ADMIN_MESSAGE,
  isSuperAdminUser
} from './authSecurity';
import { formatMoney } from './utils/format';
import {
  getProductImages,
  getWenAppliancesStoragePath,
  normalizeProduct,
  parseImageList
} from './utils/images';
import { normalizeAdminOrderStatus } from './utils/status';

// The admin deployment keeps its own name while sharing the WenAppliances mark
// with the storefront, receipts, notifications, and installed app.
const isAdminHost = typeof window !== 'undefined' && (
  /^admin(?:[.-])/i.test(window.location.hostname) ||
  window.location.hostname.includes('wenappliances-admin')
);
const isAdminApp = import.meta.env.MODE === 'admin' || isAdminHost;

// --- BRANDING ---
const Logo = ({ className = "", dark = false }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <img
      src="/wen-icon.png"
      alt=""
      aria-hidden="true"
      className="h-9 w-9 shrink-0 object-contain"
    />
    <span className={`font-extrabold tracking-tight text-xl ${dark ? 'text-white' : 'text-[#111214]'}`}>
      {isAdminApp ? <>Admin<span className="text-[#2563EB] font-normal"> Wen</span></> : <>Wen<span className="text-[#9C6644] font-normal">Appliances</span></>}
    </span>
  </div>
);

const STORE_CATEGORIES = [
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

const ThemeToggle = ({ theme, toggleTheme }) => (
  <button
    type="button"
    onClick={toggleTheme}
    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    className="inline-flex items-center gap-2 rounded-full border border-[#E5E4E0] bg-white p-2 text-xs font-semibold text-[#4A5568] transition hover:border-[#9C6644] hover:text-[#9C6644] lg:px-3 lg:py-2"
  >
    {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    <span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'} theme</span>
  </button>
);

// --- GLOBAL STATE & CONTEXT ---
const AppContext = React.createContext();

class AdminRouteErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Admin page error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-red-200" role="alert">
        <h1 className="text-xl font-bold">This admin page could not load</h1>
        <p className="mt-2 text-sm text-red-200/80">Refresh your administrator session and try this section again.</p>
        {this.state.error?.message && <p className="mt-3 break-words rounded-lg bg-black/20 p-3 text-xs text-red-200/70">{this.state.error.message}</p>}
        <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-[#9C6644] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8A5A3C]">Refresh admin session</button>
      </section>
    );
  }
}


const ProductPlaceholder = ({ className = '', dark = false }) => (
  <div className={`flex items-center justify-center ${dark ? 'bg-[#24272A] text-[#858884]' : 'bg-[#EAE8E1] text-[#9C6644]'} ${className}`}>
    <Package className="h-10 w-10 opacity-50" />
  </div>
);

const mapAuthUser = (authUser) => {
  if (!authUser) return null;

  return {
    id: authUser.id,
    email: authUser.email || '',
    // Authorization roles must come from trusted app_metadata, never user-editable user_metadata.
    role: String(authUser.app_metadata?.role || 'CUSTOMER').trim().toUpperCase(),
    name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User'
  };
};

const getRouteFromLocation = () => {
  try {
    const location = new URL(window.location.href);
    if (location.searchParams.has('reset-password')) return '/reset-password';
    return location.pathname.replace(/\/$/, '') || '/';
  } catch {
    return '/';
  }
};

const isMissingDatabaseColumn = (error, column) => {
  const message = String(error?.message || '').toLowerCase();
  return ['42703', 'PGRST204'].includes(error?.code)
    && message.includes(String(column).toLowerCase());
};

const getSeoDescription = (value, fallback) => {
  const plainText = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plainText) return fallback;
  return plainText.length > 155 ? `${plainText.slice(0, 152).trimEnd()}...` : plainText;
};

const getSeoImageUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${STOREFRONT_SITE_URL}${value}`;
  return null;
};

const RouteSeo = ({ currentRoute, products }) => {
  const adminSiteUrl = typeof window !== 'undefined' ? window.location.origin : STOREFRONT_SITE_URL;

  if (isAdminApp) {
    return (
      <SEO
        title="Admin Wen | Administration portal"
        description="Secure administration portal for managing WenAppliances inventory, orders, members, and support conversations."
        canonicalPath={typeof window !== 'undefined' ? window.location.pathname : '/'}
        siteUrl={adminSiteUrl}
        robots="noindex, nofollow"
        image={`${adminSiteUrl}/admin-wen-logo.svg`}
      />
    );
  }

  if (currentRoute === '/') {
    return (
      <SEO
        title="WenAppliances | Appliances for your home"
        description="Shop refrigerators, washers, dryers, and other home appliances from WenAppliances with clear pricing, delivery options, and customer support."
        canonicalPath="/"
      />
    );
  }

  if (currentRoute === '/products') {
    return (
      <SEO
        title="Shop Appliances | WenAppliances"
        description="Browse available refrigerators, washers, dryers, and other home appliances from WenAppliances."
        canonicalPath="/products"
        type="website"
      />
    );
  }

  if (currentRoute === '/terms') {
    return (
      <SEO
        title="Terms and Conditions | Wen Appliances"
        description="Read the terms for using the Wen Appliances website, placing orders, delivery, pickup and product support."
        canonicalPath="/terms"
        type="website"
      />
    );
  }

  const productMatch = currentRoute.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    let productId = productMatch[1];
    try {
      productId = decodeURIComponent(productId);
    } catch {
      // Keep the route segment as-is when a malformed URL is provided.
    }

    const product = products.find((item) => String(item.id) === String(productId));
    const canonicalPath = `/product/${encodeURIComponent(productId)}`;
    if (!product) {
      return (
        <SEO
          title="Appliance details | WenAppliances"
          description="View appliance details, pricing, availability, delivery options, and support from WenAppliances."
          canonicalPath={canonicalPath}
          robots="noindex, nofollow"
        />
      );
    }

    const productImages = getProductImages(product).map(getSeoImageUrl).filter(Boolean);
    const description = getSeoDescription(
      product.description,
      `${product.name} from WenAppliances. Check current pricing, availability, delivery options, and product details.`
    );
    const stock = Number(product.stock || 0);

    return (
      <SEO
        title={`${product.name} | WenAppliances`}
        description={description}
        canonicalPath={canonicalPath}
        image={productImages[0] || STOREFRONT_DEFAULT_IMAGE}
        imageAlt={`${product.name} from WenAppliances`}
        type="product"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description,
          image: productImages.length > 0 ? productImages : [STOREFRONT_DEFAULT_IMAGE],
          sku: product.sku || undefined,
          category: product.category || undefined,
          brand: {
            '@type': 'Brand',
            name: 'WenAppliances'
          },
          offers: {
            '@type': 'Offer',
            url: `${STOREFRONT_SITE_URL}${canonicalPath}`,
            priceCurrency: 'USD',
            price: Number.isFinite(Number(product.price)) ? Number(product.price).toFixed(2) : '0.00',
            availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
          }
        }}
      />
    );
  }

  return (
    <SEO
      title="WenAppliances"
      description="Shop home appliances from WenAppliances."
      canonicalPath={currentRoute || '/'}
      robots="noindex, nofollow"
    />
  );
};

export default function App() {
  const adminBasePath = isAdminApp ? '' : '/hq-operations';
  const [currentRoute, setCurrentRoute] = useState(getRouteFromLocation);
  const [user, setUser] = useState(null); // null = guest
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = window.localStorage.getItem('wenappliances-theme');
      return savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : 'light';
    } catch {
      return 'light';
    }
  });
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  
  // Database State
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [productVisibilityAvailable, setProductVisibilityAvailable] = useState(null);
  const [orders, setOrders] = useState([]);
  const [trackingPrefill, setTrackingPrefill] = useState(null);
  
  // Cart State
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const rejectedSessionRef = useRef('');
  const signOutScheduledRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const syncSession = (session, announce = false) => {
      if (!mounted) return;

      const authUser = session?.user;
      if (!authUser) {
        setUser(null);
        return;
      }

      const isSuperAdmin = isSuperAdminUser(authUser);
      const isWrongPortal = isAdminApp ? !isSuperAdmin : isSuperAdmin;
      if (isWrongPortal) {
        setUser(null);

        const rejectedKey = `${isAdminApp ? 'admin' : 'storefront'}:${authUser.id}`;
        if (announce && rejectedSessionRef.current !== rejectedKey) {
          rejectedSessionRef.current = rejectedKey;
          toast.error(isAdminApp ? ADMIN_PORTAL_ROLE_MESSAGE : CUSTOMER_PORTAL_ADMIN_MESSAGE);
        }

        // Do not await signOut inside onAuthStateChange; Supabase warns that
        // doing so can deadlock the auth event callback.
        if (!signOutScheduledRef.current) {
          signOutScheduledRef.current = true;
          window.setTimeout(() => {
            supabase.auth.signOut().finally(() => {
              signOutScheduledRef.current = false;
            });
          }, 0);
        }
        return;
      }

      rejectedSessionRef.current = '';
      setUser(mapAuthUser(authUser));
    };

    supabase.auth.getSession().then(({ data: { session } }) => syncSession(session, true));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session, true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleBrowserNavigation = () => setCurrentRoute(getRouteFromLocation());
    window.addEventListener('popstate', handleBrowserNavigation);
    return () => window.removeEventListener('popstate', handleBrowserNavigation);
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError('');

    try {
      const buildProductsQuery = (includeVisibility) => {
        let query = supabase
        .from('products')
          .select(includeVisibility
            ? 'id, name, category, price, stock, images, description, is_published'
            : 'id, name, category, price, stock, images, description');

        if (includeVisibility && !isAdminApp) query = query.eq('is_published', true);
        return query;
      };

      let { data, error } = await buildProductsQuery(true);
      if (isMissingDatabaseColumn(error, 'is_published')) {
        setProductVisibilityAvailable(false);
        // Keep the storefront usable while the additive visibility migration
        // is being applied. Existing products remain visible until then.
        ({ data, error } = await buildProductsQuery(false));
      } else if (!error) {
        setProductVisibilityAvailable(true);
      }

      if (error) throw error;
      setProducts((data ?? []).map(normalizeProduct));
    } catch (error) {
      setProducts([]);
      setProductsError(error?.message || 'Unable to load products. Please try again.');
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Router logic
  const navigate = (path) => {
    const nextLocation = new URL(path, window.location.origin);
    const nextRoute = nextLocation.searchParams.has('reset-password')
      ? '/reset-password'
      : nextLocation.pathname.replace(/\/$/, '') || '/';
    const nextUrl = `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`;

    if (window.location.pathname !== nextLocation.pathname || window.location.search !== nextLocation.search || window.location.hash !== nextLocation.hash) {
      window.history.pushState({}, '', nextUrl);
    }

    setCurrentRoute(nextRoute);
    window.dispatchEvent(new CustomEvent('wen:navigate', { detail: { path: nextUrl } }));
    window.scrollTo(0, 0);
  };

  // Cart Logic
  const addToCart = (productId, quantity = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock < quantity) {
        toast.error('Not enough stock available.'); // Fallback if UI check fails
        return;
    }
    
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        // Enforce stock limit in cart
        const newQty = Math.min(existing.quantity + quantity, product.stock);
        return prev.map(item => item.productId === productId ? { ...item, quantity: newQty } : item);
      }
      return [...prev, { productId, quantity, price: product.price, name: product.name, image: product.image }];
    });
    setIsCartOpen(true);
  };

  const updateCartQty = (productId, qty) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(item => item.productId !== productId));
      return;
    }
    const product = products.find(p => p.id === productId);
    if (product && qty > product.stock) return; // Prevent exceeding stock
    
    setCart(prev => prev.map(item => item.productId === productId ? { ...item, quantity: qty } : item));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const saveProduct = async (product) => {
    const { isNew, id, created_at, updated_at, ...formProduct } = product;
    const images = parseImageList(formProduct.gallery || formProduct.images || formProduct.image);
    const payload = {
      name: formProduct.name,
      category: formProduct.category,
      price: Number(formProduct.price),
      stock: Number(formProduct.stock),
      description: formProduct.description || '',
      images,
      is_published: formProduct.is_published !== false
    };

    const save = (productPayload) => isNew
      ? supabase.from('products').insert(productPayload).select().single()
      : supabase.from('products').update(productPayload).eq('id', id).select().single();
    let { data, error } = await save(payload);
    if (isMissingDatabaseColumn(error, 'is_published')) {
      const { is_published: omittedVisibility, ...compatiblePayload } = payload;
      ({ data, error } = await save(compatiblePayload));
    }

    if (error) throw error;

    const savedProduct = normalizeProduct(data);
    setProducts(prev => isNew
      ? [savedProduct, ...prev]
      : prev.map(item => item.id === savedProduct.id ? savedProduct : item)
    );
    return savedProduct;
  };

  const setProductPublished = async (productId, isPublished) => {
    const previousProducts = products;
    setProducts((current) => current.map((product) => product.id === productId
      ? normalizeProduct({ ...product, is_published: isPublished })
      : product));

    const { error } = await supabase
      .from('products')
      .update({ is_published: isPublished })
      .eq('id', productId);

    if (error) {
      setProducts(previousProducts);
      if (isMissingDatabaseColumn(error, 'is_published')) {
        setProductVisibilityAvailable(false);
        const migrationError = new Error('Apply the Supabase admin dashboard migration before changing product visibility.');
        migrationError.code = 'ADMIN_DASHBOARD_MIGRATION_REQUIRED';
        throw migrationError;
      }
      throw error;
    }
  };

  const deleteProduct = async (product) => {
    const productId = typeof product === 'object' ? product?.id : product;
    if (!productId) throw new Error('This product is missing its database ID.');

    const productImages = typeof product === 'object'
      ? [
          ...parseImageList(product.images),
          ...parseImageList(product.gallery),
          ...parseImageList(product.image)
        ]
      : [];
    const storagePaths = [...new Set(productImages.map(getWenAppliancesStoragePath).filter(Boolean))];

    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (deleteError) throw deleteError;

    setProducts((currentProducts) => currentProducts.filter((item) => item.id !== productId));
    setCart((currentCart) => currentCart.filter((item) => item.productId !== productId));

    if (storagePaths.length === 0) return { storageWarning: '' };

    const { error: storageError } = await supabase.storage
      .from('Wenappliances')
      .remove(storagePaths);

    return { storageWarning: storageError?.message || '' };
  };

  // Auth Logic
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return false;

    const { data: verifiedUserData, error: verifiedUserError } = await supabase.auth.getUser();
    const verifiedUser = verifiedUserData?.user || data.user;
    if (verifiedUserError || !isSuperAdminUser(verifiedUser)) {
      await supabase.auth.signOut();
      return false;
    }

    const signedInUser = mapAuthUser(verifiedUser);
    setUser(signedInUser);
    return true;
  };
  const logout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    navigate('/');
  };

  const toggleTheme = () => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    try {
      window.localStorage.setItem('wenappliances-theme', theme);
    } catch {
      // Continue without persistence if browser storage is unavailable.
    }
  }, [theme]);

  const contextValue = {
    user, login, logout,
    products, setProducts, saveProduct, deleteProduct, setProductPublished, loadProducts, productsLoading, productsError, productVisibilityAvailable,
    orders, setOrders,
    cart, addToCart, updateCartQty, clearCart, cartTotal, cartItemCount, isCartOpen, setIsCartOpen,
    navigate, currentRoute,
    isAdminApp, adminBasePath,
    theme, toggleTheme,
    searchQuery, setSearchQuery,
    activeCategory, setActiveCategory
  };

  // --- ROUTER DISPATCHER ---
  const renderRoute = () => {
    // The admin deployment has its own root and routes. The storefront never renders admin UI.
    if (isAdminApp) {
      if (!user || user.role !== 'SUPER_ADMIN') {
        return (
          <Suspense fallback={<AdminRouteLoading />}>
            <SecureAdminLogin theme={theme} toggleTheme={toggleTheme} onAuthenticated={() => navigate('/dashboard')} onClose={() => navigate('/')} />
          </Suspense>
        );
      }
      return <AdminLayout><AdminRouteErrorBoundary key={currentRoute}><Suspense fallback={<AdminRouteLoading />}><AdminRouter route={currentRoute} /></Suspense></AdminRouteErrorBoundary></AdminLayout>;
    }

    // Legacy admin URLs on the storefront are intentionally not exposed.
    if (currentRoute.startsWith('/hq-operations')) return <StoreLayout><StoreHome /></StoreLayout>;

    // Storefront Routes
    return (
      <StoreLayout>
        {currentRoute === '/' && <StoreHome />}
        {currentRoute === '/products' && (
          <LiveApplianceCatalog
            products={products}
            loading={productsLoading}
            error={productsError}
            onRetry={loadProducts}
            onProductClick={(productId) => navigate(`/product/${productId}`)}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            activeCategory={activeCategory || 'All'}
            onActiveCategoryChange={(category) => setActiveCategory(category === 'All' ? '' : category)}
          />
        )}
        {currentRoute.startsWith('/product/') && <StoreProductDetail id={currentRoute.split('/')[2]} />}
        <Suspense fallback={<StoreRouteLoading />}>
          {currentRoute === '/checkout' && <Checkout cart={cart} cartTotal={cartTotal} clearCart={clearCart} navigate={navigate} onOrderPlaced={({ orderId, email, trackingToken }) => {
            rememberOrderForNotifications(orderId, email, trackingToken);
            setTrackingPrefill({ orderId, email, trackingToken });
          }} />}
          {currentRoute === '/terms' && <TermsAndConditions />}
          {currentRoute === '/reset-password' && <ResetPassword navigate={navigate} />}
          {currentRoute === '/my-orders' && <OrderTracking initialValues={{ email: user?.email || '' }} accountMode />}
          {currentRoute.startsWith('/track-order') && <OrderTracking initialValues={{ email: trackingPrefill?.email || user?.email || '', trackingToken: trackingPrefill?.trackingToken || '' }} />}
        </Suspense>
      </StoreLayout>
    );
  };

  return (
    <ChatNotificationProvider isAdmin={isAdminApp} user={user} active={!isAdminApp || user?.role === 'SUPER_ADMIN'}>
      <AppContext.Provider value={contextValue}>
        <PushNotificationRegistration user={user} active={!isAdminApp || user?.role === 'SUPER_ADMIN'} />
        <NativeAdminController active={isAdminApp} currentRoute={currentRoute} theme={theme} />
        <RouteSeo currentRoute={currentRoute} products={products} />
        <div className={isAdminApp ? 'min-h-screen font-sans bg-[#F4F3EF] text-[#111214] antialiased' : 'storefront-shell min-h-screen font-sans antialiased'}>
          {renderRoute()}
        </div>
        <OrderNotificationPrompt isAdmin={isAdminApp} active={!isAdminApp || user?.role === 'SUPER_ADMIN'} />
        {isAdminApp ? <AdminOrderNotificationWatcher user={user} /> : <CustomerOrderNotificationWatcher user={user} refreshKey={trackingPrefill?.orderId} />}
        <PresenceTracker user={user} />
      </AppContext.Provider>
    </ChatNotificationProvider>
  );
}

// ============================================================================
// STOREFRONT COMPONENTS
// Theme: "Muted Professionalism" (Off-white bg, Charcoal text, Copper accents)
// ============================================================================

const StoreLayout = ({ children }) => {
  const { cartItemCount, setIsCartOpen, navigate, user, products, searchQuery, setSearchQuery, setActiveCategory, productsLoading, productsError, loadProducts, theme, toggleTheme } = useContext(AppContext);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [contactLoading, setContactLoading] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterMessage, setNewsletterMessage] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const searchSuggestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    const suggestions = [];
    const seen = new Set();
    const addSuggestion = (value, type) => {
      const normalizedValue = value.trim();
      const key = normalizedValue.toLowerCase();
      if (!normalizedValue || seen.has(key)) return;
      seen.add(key);
      suggestions.push({ value: normalizedValue, type });
    };

    (products ?? [])
      .filter((product) => product.status !== 'ARCHIVED')
      .forEach((product) => {
        const productName = String(product.name ?? '').trim();
        if (productName.toLowerCase().includes(query)) addSuggestion(productName, 'Product');
      });

    STORE_CATEGORIES
      .filter((category) => category.toLowerCase().includes(query))
      .forEach((category) => addSuggestion(category, 'Category'));

    return suggestions.slice(0, 6);
  }, [products, searchQuery]);

  const chooseSearchSuggestion = (value) => {
    setSearchQuery(value);
    setActiveCategory('');
    setIsSearchOpen(false);
    setIsMobileMenuOpen(false);
    navigate('/products');
  };

  const handleNewsletterSubmit = async (event) => {
    event.preventDefault();
    if (!newsletterEmail.trim()) return;
    const { error } = await supabase.from('newsletter_subscribers').insert({
      email: newsletterEmail.trim().toLowerCase()
    });
    if (error?.code === '23505') {
      setNewsletterMessage("You're already subscribed!");
    } else if (error) {
      setNewsletterMessage('Something went wrong. Please try again.');
    } else {
      setNewsletterMessage("You're subscribed! We'll be in touch.");
      setNewsletterEmail('');
    }
  };

  const handleContactSubmit = async (event) => {
    event.preventDefault();
    const name = contactForm.name.trim();
    const email = contactForm.email.trim().toLowerCase();
    const message = contactForm.message.trim();
    if (!name || !email || !message) {
      toast.error('Please complete all contact fields.');
      return;
    }

    setContactLoading(true);
    const { error } = await supabase.from('contact_messages').insert({ name, email, message });
    setContactLoading(false);
    if (error) {
      toast.error('Could not send your message. Please email us directly.');
      return;
    }

    setContactSent(true);
    setContactForm({ name: '', email: '', message: '' });
  };
  
  const handleNav = (path, clearFilters = false) => {
    if (clearFilters) {
      setSearchQuery('');
      setActiveCategory('');
    }
    setIsMobileMenuOpen(false);
    navigate(path);
  };

  return (
    <div className="store-layout flex min-h-screen flex-col">
      <header className="store-header sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="store-header__inner mx-auto flex h-16 min-w-0 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <button type="button" onClick={() => handleNav('/', true)} className="store-brand-button" aria-label="Wen Appliances home">
              <Logo />
            </button>
            <nav aria-label="Main navigation" className="store-desktop-nav hidden md:flex gap-5 text-sm font-medium">
              <button type="button" onClick={() => handleNav('/', true)} className="store-nav-link">Home</button>
              <button type="button" onClick={() => handleNav('/products', true)} className="store-nav-link">All products</button>
              <button type="button" onClick={() => navigate('/track-order')} className="store-nav-link">Track order</button>
              <button type="button" onClick={() => setIsContactOpen(true)} className="store-nav-link">Support</button>
            </nav>
          </div>
          
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="store-header-search relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#858884]" />
              <input 
                type="text" 
                placeholder="Search products..." 
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => { setSearchQuery(e.target.value); setIsSearchOpen(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setIsSearchOpen(false);
                    navigate('/products');
                  }
                  if (e.key === 'Escape') setIsSearchOpen(false);
                }}
                aria-label="Search appliances"
                className="store-search-input pl-10 pr-4 py-2 w-64 text-sm"
              />
              {isSearchOpen && searchSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[#E5E4E0] bg-white py-1 shadow-xl" role="listbox" aria-label="Search suggestions">
                  {searchSuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.type}-${suggestion.value}`}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => chooseSearchSuggestion(suggestion.value)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-[#111214] transition-colors hover:bg-[#F4F3EF]"
                    >
                      <span className="truncate">{suggestion.value}</span>
                      <span className="shrink-0 text-xs text-[#858884]">{suggestion.type}</span>
                    </button>
                  ))}
                </div>
              )}
              {isSearchOpen && searchQuery.trim() && searchSuggestions.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-[#E5E4E0] bg-white px-4 py-3 text-sm text-[#858884] shadow-xl">
                  No products match “{searchQuery.trim()}”
                </div>
              )}
            </div>
            
            <div className="hidden md:block"><ChatNotificationBell /></div>
            <div className="hidden md:block"><AccountMenu user={user} onTrackOrder={() => navigate('/track-order')} onMyOrders={() => navigate('/my-orders')} /></div>

            <div className="hidden md:block"><ThemeToggle theme={theme} toggleTheme={toggleTheme} /></div>
            
            <button 
              onClick={() => setIsCartOpen(true)}
              type="button"
              className="store-icon-button relative"
              aria-label={cartItemCount > 0 ? `Open shopping cart, ${cartItemCount} items` : 'Open shopping cart'}
            >
              <ShoppingCart className="h-5 w-5 text-[#4A5568]" />
              {cartItemCount > 0 && (
                <span className="absolute top-0 right-0 bg-[#9C6644] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">
                  {cartItemCount}
                </span>
              )}
            </button>

            <div className="md:hidden"><ChatNotificationBell /></div>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className="store-icon-button md:hidden"
              aria-label={isMobileMenuOpen ? 'Close storefront menu' : 'Open storefront menu'}
              aria-expanded={isMobileMenuOpen}
              aria-controls="storefront-mobile-menu"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-x-0 bottom-0 top-16 z-[45] bg-black/25 backdrop-blur-[1px] md:hidden"
              aria-label="Close storefront menu"
            />
            <div id="storefront-mobile-menu" className="store-mobile-menu fixed inset-x-3 top-[4.5rem] z-[50] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border p-3 text-left md:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#858884]" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onFocus={() => setIsSearchOpen(true)}
                  onChange={(event) => { setSearchQuery(event.target.value); setIsSearchOpen(true); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setIsSearchOpen(false);
                      setIsMobileMenuOpen(false);
                      navigate('/products');
                    }
                    if (event.key === 'Escape') setIsSearchOpen(false);
                  }}
                  className="store-search-input w-full py-3 pl-10 pr-3 text-sm"
                />
                {isSearchOpen && searchSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-[#E5E4E0] bg-white py-1 shadow-xl" role="listbox" aria-label="Search suggestions">
                    {searchSuggestions.map((suggestion) => (
                      <button
                        key={`mobile-${suggestion.type}-${suggestion.value}`}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => chooseSearchSuggestion(suggestion.value)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-[#111214] transition-colors hover:bg-[#F4F3EF]"
                      >
                        <span className="truncate">{suggestion.value}</span>
                        <span className="shrink-0 text-xs text-[#858884]">{suggestion.type}</span>
                      </button>
                    ))}
                  </div>
                )}
                {isSearchOpen && searchQuery.trim() && searchSuggestions.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-2 rounded-xl border border-[#E5E4E0] bg-white px-3 py-2.5 text-sm text-[#858884] shadow-xl">
                    No products match “{searchQuery.trim()}”
                  </div>
                )}
              </div>

              <nav className="mt-3 grid gap-1 border-t border-[#E5E4E0] pt-3" aria-label="Storefront navigation">
                <button type="button" onClick={() => handleNav('/', true)} className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#4A5568] transition hover:bg-white hover:text-[#111214]">Home</button>
                <button type="button" onClick={() => handleNav('/products', true)} className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#4A5568] transition hover:bg-white hover:text-[#111214]">All Products</button>
                <button type="button" onClick={() => { setIsMobileMenuOpen(false); navigate('/track-order'); }} className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#4A5568] transition hover:bg-white hover:text-[#111214]">Track Order</button>
                <button type="button" onClick={() => { setIsMobileMenuOpen(false); setIsContactOpen(true); }} className="rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#4A5568] transition hover:bg-white hover:text-[#111214]">Support</button>
              </nav>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#E5E4E0] px-3 pt-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#858884]">Account & display</span>
                <div className="flex items-center gap-2">
                  <AccountMenu user={user} onTrackOrder={() => { setIsMobileMenuOpen(false); navigate('/track-order'); }} onMyOrders={() => { setIsMobileMenuOpen(false); navigate('/my-orders'); }} />
                  <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
                </div>
              </div>
            </div>
          </>
        )}
      </header>
      
      <main className="grow">
        {productsLoading && (
          <div className="store-load-banner px-4 py-3 text-center text-sm" role="status">
            Loading the live appliance catalog...
          </div>
        )}
        {productsError && (
          <div className="store-error-banner px-4 py-3 text-center text-sm" role="alert">
            <span>We couldn’t load the live appliance catalog. Please try again.</span>
            <button type="button" onClick={loadProducts} className="ml-3 font-semibold underline">Try again</button>
          </div>
        )}
        {children}
      </main>
      
      <footer className="store-footer mt-auto py-12">
        <div className="store-footer__grid mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          <div>
            <div className="mb-4 block text-left" aria-label="WenAppliances">
              <Logo />
            </div>
            <p className="store-footer__copy text-sm leading-relaxed">Shop refrigerators, washers, dryers, and household appliances with clear pricing, delivery options, and direct support.</p>
          </div>
          <div>
            <h3 className="store-footer__title mb-4 font-semibold">Shop</h3>
            <ul className="store-footer__links space-y-2 text-sm">
              <li><button type="button" onClick={() => navigate('/products')}>All products</button></li>
              <li><button type="button" onClick={() => navigate('/products')}>Browse categories</button></li>
            </ul>
          </div>
          <div>
            <h3 className="store-footer__title mb-4 font-semibold">Support</h3>
            <ul className="store-footer__links space-y-2 text-sm">
              <li><button type="button" onClick={() => setIsContactOpen(true)}>Contact us</button></li>
              <li><button type="button" onClick={() => navigate('/track-order')}>Track order</button></li>
              <li><button type="button" onClick={() => navigate('/terms')}>Terms and conditions</button></li>
            </ul>
          </div>
          <div>
            <h3 className="store-footer__title mb-4 font-semibold">Newsletter</h3>
            <p className="store-footer__copy mb-4 text-sm">Subscribe for updates on new arrivals and offers.</p>
            <form onSubmit={handleNewsletterSubmit} className="store-newsletter-form flex">
              <label htmlFor="newsletter-email" className="sr-only">Email address</label>
              <input id="newsletter-email" type="email" required value={newsletterEmail} onChange={(event) => { setNewsletterEmail(event.target.value); setNewsletterMessage(''); }} placeholder="Email address" className="store-search-input min-w-0 w-full rounded-r-none px-3 py-2 text-sm" />
              <button type="submit" className="store-button-primary shrink-0 rounded-l-none px-4 text-sm font-medium">Subscribe</button>
            </form>
            {newsletterMessage && <p className="mt-2 text-xs font-medium text-[#D8B49A]" role="status" aria-live="polite">{newsletterMessage}</p>}
          </div>
        </div>
        
        <div className="store-footer__legal mx-auto mt-10 flex max-w-7xl flex-col items-start justify-between gap-3 border-t px-4 pt-6 text-sm sm:px-6 md:flex-row md:items-center lg:px-8">
          <p>&copy; {new Date().getFullYear()} Wen Appliances. All rights reserved.</p>
          <a className="store-portfolio-link" href="https://gikunjucreates.work.gd/" target="_blank" rel="noopener noreferrer">@gikunju creates</a>
        </div>
      </footer>

      {/* Contact Modal */}
      {isContactOpen && (
        <div className="store-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setIsContactOpen(false)}>
          <div className="store-contact-dialog relative w-full max-w-md rounded-xl p-6 md:p-8" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => {setIsContactOpen(false); setContactSent(false);}} className="store-dialog-close" aria-label="Close contact dialog"><X className="h-5 w-5" /></button>
            
            {contactSent ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
                <h3 id="contact-dialog-title" className="text-xl font-bold mb-2 text-[#111214]">Message sent</h3>
                  <p className="text-[#4A5568]">Your message has been successfully sent to {SUPPORT_EMAIL}. We'll get back to you shortly.</p>
              </div>
            ) : (
              <>
                <h3 id="contact-dialog-title" className="text-2xl font-bold mb-6 text-[#111214]">Contact support</h3>
                
                <div className="store-contact-details mb-6 space-y-2 rounded-lg p-4 text-left text-sm">
                  <p className="font-medium text-[#111214]">Direct Contact Information:</p>
                  <p>Email: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#9C6644] hover:underline">{SUPPORT_EMAIL}</a></p>
                  <p>Phone: {SUPPORT_PHONE}</p>
                </div>

                <form onSubmit={handleContactSubmit} className="space-y-4 text-left">
                  <div>
                    <label htmlFor="contact-name" className="block text-sm font-medium text-[#4A5568] mb-1">Name</label>
                    <input id="contact-name" type="text" required maxLength={120} autoComplete="name" value={contactForm.name} onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))} className="store-input w-full rounded-lg px-4 py-2.5" />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className="block text-sm font-medium text-[#4A5568] mb-1">Email</label>
                    <input id="contact-email" type="email" required maxLength={254} autoComplete="email" value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} className="store-input w-full rounded-lg px-4 py-2.5" />
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="block text-sm font-medium text-[#4A5568] mb-1">Message</label>
                    <textarea id="contact-message" rows={4} required maxLength={5000} value={contactForm.message} onChange={(event) => setContactForm((current) => ({ ...current, message: event.target.value }))} className="store-input w-full resize-y rounded-lg px-4 py-2.5"></textarea>
                  </div>
                  <button type="submit" disabled={contactLoading} className="store-button-primary mt-4 w-full px-4 font-medium">{contactLoading ? 'Sending…' : 'Send message'}</button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <CartDrawer />
    </div>
  );
};

const CartDrawer = () => {
  const { cart, isCartOpen, setIsCartOpen, updateCartQty, cartTotal, navigate } = useContext(AppContext);

  if (!isCartOpen) return null;

  return (
    <>
      <div className="store-cart-backdrop fixed inset-0 z-50 transition-opacity" onClick={() => setIsCartOpen(false)} />
      <div className="store-cart-drawer fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b border-[#E5E4E0]">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Your Cart
          </h2>
          <button onClick={() => setIsCartOpen(false)} className="p-2 hover:bg-[#F4F3EF] rounded-full transition-colors">
            <X className="h-5 w-5 text-[#4A5568]" />
          </button>
        </div>
        
        <div className="grow overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-[#858884]">
              <Package className="h-12 w-12 opacity-20" />
              <p>Your cart is empty.</p>
              <button onClick={() => { setIsCartOpen(false); navigate('/products'); }} className="text-[#9C6644] font-medium hover:underline">Continue Shopping</button>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.productId} className="flex gap-4 bg-[#F4F3EF] p-3 rounded-lg border border-[#E5E4E0]">
                <button
                  type="button"
                  onClick={() => { setIsCartOpen(false); navigate(`/product/${item.productId}`); }}
                  className="w-20 h-20 rounded-md bg-white cursor-pointer hover:opacity-80 transition-opacity overflow-hidden"
                >
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="product-photo h-full w-full object-cover" />
                  ) : (
                    <ProductPlaceholder className="w-full h-full" />
                  )}
                </button>
                <div className="grow flex flex-col justify-between">
                  <div>
                    <h3 
                      onClick={() => { setIsCartOpen(false); navigate(`/product/${item.productId}`); }}
                      className="font-medium text-sm line-clamp-2 cursor-pointer hover:text-[#9C6644] transition-colors"
                    >
                      {item.name}
                    </h3>
                    <p className="text-[#9C6644] font-semibold mt-1">{formatMoney(item.price)}</p>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-[#E5E4E0] rounded bg-white">
                      <button onClick={() => updateCartQty(item.productId, item.quantity - 1)} className="px-2 py-1 text-[#4A5568] hover:bg-[#F4F3EF]">-</button>
                      <span className="px-2 py-1 text-sm font-medium w-8 text-center">{item.quantity}</span>
                      <button onClick={() => updateCartQty(item.productId, item.quantity + 1)} className="px-2 py-1 text-[#4A5568] hover:bg-[#F4F3EF]">+</button>
                    </div>
                    <button onClick={() => updateCartQty(item.productId, 0)} className="text-xs text-red-500 font-medium hover:underline">Remove</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {cart.length > 0 && (
          <div className="border-t border-[#E5E4E0] p-4 bg-white space-y-4">
            <div className="flex justify-between items-center text-lg font-bold">
              <span>Subtotal</span>
              <span>{formatMoney(cartTotal)}</span>
            </div>
            <p className="text-xs text-[#858884]">Taxes and delivery calculated at checkout.</p>
            <button 
              onClick={() => { setIsCartOpen(false); navigate('/checkout'); }}
              className="w-full bg-[#9C6644] hover:bg-[#8A5A3C] text-white py-3 rounded-lg font-medium transition-colors shadow-sm"
            >
              Proceed to Checkout
            </button>
          </div>
        )}
      </div>
    </>
  );
};

const StoreHome = () => {
  const { products, navigate, productsLoading, setActiveCategory } = useContext(AppContext);
  const featured = products.filter(p => p.status === 'PUBLISHED').slice(0, 4);
  const quickCategories = ['Refrigerators', 'Washers', 'Dryers', 'Washer & Dryer'];

  const browseCategory = (category) => {
    setActiveCategory(category);
    navigate('/products');
  };

  return (
    <div className="store-home">
      <section className="store-hero">
        <div className="store-hero__inner mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="store-eyebrow mb-4 text-sm font-semibold uppercase tracking-[0.12em]">Wen Appliances · Available now</p>
            <h1 className="store-hero__title max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">Find the right appliance for your home.</h1>
            <p className="store-hero__copy mt-5 max-w-xl text-base leading-7 sm:text-lg">Browse current stock with clear prices, delivery options and direct product support.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => navigate('/products')} className="store-button-primary px-5">Shop all appliances</button>
              <button type="button" onClick={() => navigate('/track-order')} className="store-button-secondary px-5">Track an order</button>
            </div>
          </div>
        </div>
      </section>

      <section className="store-category-section mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-labelledby="browse-category-title">
        <h2 id="browse-category-title" className="store-section-title text-lg font-semibold">Browse by category</h2>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Appliance categories">
          {quickCategories.map((category) => (
            <button key={category} type="button" onClick={() => browseCategory(category)} className="store-category-link shrink-0 px-4">
              {category}
            </button>
          ))}
        </nav>
      </section>

      <section className="store-featured-section mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8" aria-labelledby="featured-products-title">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 id="featured-products-title" className="store-section-title text-2xl font-semibold tracking-tight">Available appliances</h2>
            <p className="store-muted mt-2 text-sm">A selection from today’s live catalog.</p>
          </div>
          <button type="button" onClick={() => navigate('/products')} className="store-text-link inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
            View all <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="store-product-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {productsLoading ? (
            Array.from({ length: 4 }, (_, index) => <ProductCardSkeleton key={index} />)
          ) : featured.length === 0 ? (
            <div className="store-empty-state col-span-full px-6 py-14 text-center">
              <h3 className="text-lg font-semibold">No in-stock appliances to feature right now</h3>
              <p className="store-muted mt-2">Browse the full catalog or contact us to ask about upcoming stock.</p>
              <button type="button" onClick={() => navigate('/products')} className="store-button-secondary mt-5 px-5">Browse catalog</button>
            </div>
          ) : featured.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>
    </div>
  );
};

const ProductCardSkeleton = () => (
  <article className="store-product-card store-product-card--skeleton" aria-hidden="true">
    <div className="store-skeleton store-product-card__media" />
    <div className="space-y-3 p-4">
      <div className="store-skeleton h-3 w-1/3 rounded" />
      <div className="store-skeleton h-5 w-4/5 rounded" />
      <div className="store-skeleton h-10 w-full rounded-lg" />
    </div>
  </article>
);

const ProductCard = ({ product }) => {
  const { navigate, addToCart } = useContext(AppContext);
  const isOutOfStock = product.stock <= 0;
  const primaryImage = getProductImages(product)[0];

  return (
    <article className="store-product-card group flex h-full flex-col overflow-hidden">
      <button type="button" onClick={() => navigate(`/product/${product.id}`)} className="store-product-card__view text-left" aria-label={`View ${product.name}`}>
        <div className="store-product-card__media product-photo-surface relative aspect-[4/3] overflow-hidden">
          {primaryImage ? (
            <img src={primaryImage} alt={product.name} loading="lazy" decoding="async" className="store-product-card__image product-photo h-full w-full object-cover" />
          ) : <ProductPlaceholder className="h-full w-full" />}
          <span className={`store-stock-badge absolute left-3 top-3 ${isOutOfStock ? 'store-stock-badge--out' : ''}`}>
            {isOutOfStock ? 'Out of stock' : 'In stock'}
          </span>
        </div>
        <div className="px-4 pt-4">
          <p className="store-eyebrow text-xs font-semibold uppercase tracking-wider">{product.category}</p>
          <h3 className="store-product-card__title mt-1 line-clamp-2 text-base font-semibold">{product.name}</h3>
          <p className="store-product-card__price mt-3 text-lg font-semibold">{formatMoney(product.price)}</p>
        </div>
      </button>
      <div className="mt-auto px-4 pb-4 pt-4">
        <button type="button" onClick={() => addToCart(product.id)} disabled={isOutOfStock} className="store-button-secondary store-add-to-cart w-full gap-2 px-3">
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          {isOutOfStock ? 'Unavailable' : 'Add to cart'}
        </button>
      </div>
    </article>
  );
};

const StoreCatalog = () => {
  const { products, searchQuery, setSearchQuery, activeCategory, setActiveCategory } = useContext(AppContext);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const activeProducts = products.filter(p => {
    if (p.status === 'ARCHIVED') return false;
    if (activeCategory && p.category !== activeCategory) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.category.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (minPrice && p.price < Number(minPrice)) return false;
    if (maxPrice && p.price > Number(maxPrice)) return false;
    return true;
  });

  const categories = STORE_CATEGORIES;

  return (
    <div className="motion-fade-up max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight">
          {searchQuery ? `Search Results for "${searchQuery}"` : (activeCategory || 'All Products')}
        </h2>
        <p className="text-[#4A5568] mt-2">Browse our complete catalog of home appliances.</p>
      </div>
      
      <div className="flex flex-col md:flex-row gap-8">
        {/* Filters Sidebar */}
        <div className="w-full md:w-64 shrink-0 space-y-8 md:sticky md:top-24 self-start">
          <div>
            <h4 className="font-semibold mb-4 border-b border-[#E5E4E0] pb-2">Categories</h4>
            <ul className="space-y-3 text-sm text-[#4A5568]">
              <li 
                className={`flex items-center justify-between cursor-pointer transition-colors ${!activeCategory ? 'text-[#9C6644] font-bold' : 'hover:text-[#9C6644]'}`}
                onClick={() => setActiveCategory('')}
              >
                All Categories
              </li>
              {categories.map(cat => (
                <li 
                  key={cat} 
                  className={`flex items-center justify-between cursor-pointer transition-colors ${activeCategory === cat ? 'text-[#9C6644] font-bold' : 'hover:text-[#9C6644]'}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  <span>{cat}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
             <h4 className="font-semibold mb-4 border-b border-[#E5E4E0] pb-2">Price Range (USD)</h4>
             <div className="flex items-center gap-2">
               <input 
                 type="number" 
                 placeholder="Min" 
                 value={minPrice}
                 onChange={(e) => setMinPrice(e.target.value)}
                 className="w-full border border-[#E5E4E0] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#9C6644] focus:ring-1 focus:ring-[#9C6644]"
               />
               <span className="text-[#858884]">-</span>
               <input 
                 type="number" 
                 placeholder="Max" 
                 value={maxPrice}
                 onChange={(e) => setMaxPrice(e.target.value)}
                 className="w-full border border-[#E5E4E0] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#9C6644] focus:ring-1 focus:ring-[#9C6644]"
               />
             </div>
             <button 
               onClick={() => { setMinPrice(''); setMaxPrice(''); }}
               className="mt-3 text-xs text-[#858884] hover:text-[#111214] underline"
             >
               Clear Price Filter
             </button>
          </div>
        </div>
        
        {/* Product Grid */}
        <div className="grow">
          {activeProducts.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-[#E5E4E0] shadow-sm">
              <p className="text-lg text-[#858884]">No products found matching your criteria.</p>
              <button 
                onClick={() => { setActiveCategory(''); setSearchQuery(''); setMinPrice(''); setMaxPrice(''); }}
                className="mt-4 text-[#9C6644] font-medium hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeProducts.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StoreProductDetail = ({ id }) => {
  const { products, addToCart, user, navigate } = useContext(AppContext);
  const product = products.find(p => p.id === id);
  const [qty, setQty] = useState(1);
  const [imgIndex, setImgIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [lightboxPosition, setLightboxPosition] = useState({ x: 0, y: 0 });
  const lightboxDragRef = useRef(null);

  useEffect(() => {
    if (!isFullscreen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const resetLightboxViewport = () => {
    setLightboxScale(1);
    setLightboxPosition({ x: 0, y: 0 });
    lightboxDragRef.current = null;
  };

  const openFullscreen = () => {
    resetLightboxViewport();
    setIsFullscreen(true);
  };

  const closeFullscreen = () => {
    setIsFullscreen(false);
    resetLightboxViewport();
  };

  const changeLightboxZoom = (amount) => {
    setLightboxScale((currentScale) => {
      const nextScale = Math.min(3, Math.max(1, currentScale + amount));
      if (nextScale === 1) setLightboxPosition({ x: 0, y: 0 });
      return nextScale;
    });
  };

  const handleLightboxPointerDown = (event) => {
    if (lightboxScale <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    lightboxDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: lightboxPosition
    };
  };

  const handleLightboxPointerMove = (event) => {
    const drag = lightboxDragRef.current;
    if (!drag) return;
    setLightboxPosition({
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY
    });
  };

  const handleLightboxPointerUp = () => {
    lightboxDragRef.current = null;
  };

  const handleLightboxWheel = (event) => {
    event.preventDefault();
    changeLightboxZoom(event.deltaY < 0 ? 0.25 : -0.25);
  };

  if (!product) {
    return (
      <section className="store-empty-state mx-auto my-12 max-w-2xl px-6 py-12 text-center" role="status">
        <h1 className="text-xl font-semibold">This appliance isn’t available</h1>
        <p className="store-muted mt-2">It may have been removed or the link may be incorrect.</p>
        <button type="button" onClick={() => navigate('/products')} className="store-button-primary mt-5 px-5">Back to appliances</button>
      </section>
    );
  }
  const isOutOfStock = product.stock <= 0;

  const images = getProductImages(product);

  const nextImg = (e) => {
    e.stopPropagation();
    setImgIndex((prev) => (prev + 1) % images.length);
  };
  
  const prevImg = (e) => {
    e.stopPropagation();
    setImgIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <section className="store-product-detail mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8" aria-labelledby="product-title">
      
      {/* FULLSCREEN MODAL */}
      {isFullscreen && images.length > 0 && (
        <div className="product-lightbox fixed inset-0 z-[150] flex items-center justify-center bg-black/95" role="dialog" aria-modal="true" aria-label={`View ${product.name}`}>
          <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 sm:inset-x-6 sm:top-6">
            <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-black/45 p-1 text-white backdrop-blur-sm">
              <button type="button" onClick={(event) => { event.stopPropagation(); changeLightboxZoom(-0.25); }} disabled={lightboxScale <= 1} className="grid h-9 w-9 place-items-center rounded-lg text-lg transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom out">−</button>
              <span className="min-w-12 text-center text-xs font-semibold">{Math.round(lightboxScale * 100)}%</span>
              <button type="button" onClick={(event) => { event.stopPropagation(); changeLightboxZoom(0.25); }} disabled={lightboxScale >= 3} className="grid h-9 w-9 place-items-center rounded-lg text-lg transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom in">+</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); resetLightboxViewport(); }} className="rounded-lg px-2.5 py-2 text-xs font-semibold transition hover:bg-white/10">Reset</button>
            </div>
            <button type="button" onClick={(event) => { event.stopPropagation(); closeFullscreen(); }} className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-sm transition hover:bg-white/15" aria-label="Close image viewer">
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          
          {images.length > 1 && (
            <button onClick={(event) => { event.stopPropagation(); prevImg(event); }} className="absolute left-3 z-10 rounded-full p-3 text-white transition-colors hover:bg-white/10 sm:left-6">
              <ChevronRight className="h-10 w-10 rotate-180" />
            </button>
          )}
          
          <div className="product-lightbox-stage relative z-[1] flex h-full w-full items-center justify-center overflow-hidden px-14 py-20 sm:px-20" onClick={(event) => { if (event.target === event.currentTarget) closeFullscreen(); }} onWheel={handleLightboxWheel}>
            <div
              className={`product-lightbox-image ${lightboxScale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
              style={{ transform: `translate(${lightboxPosition.x}px, ${lightboxPosition.y}px) scale(${lightboxScale})` }}
              onDoubleClick={(event) => { event.stopPropagation(); lightboxScale > 1 ? resetLightboxViewport() : changeLightboxZoom(1); }}
              onPointerDown={handleLightboxPointerDown}
              onPointerMove={handleLightboxPointerMove}
              onPointerUp={handleLightboxPointerUp}
              onPointerCancel={handleLightboxPointerUp}
            >
            <img
              src={images[imgIndex]}
              alt={product.name}
              draggable="false"
              className="product-photo max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-7rem)] select-none object-contain animate-in zoom-in-95 duration-300"
            />
            </div>
          </div>
          
          {images.length > 1 && (
            <button onClick={(event) => { event.stopPropagation(); nextImg(event); }} className="absolute right-3 z-10 rounded-full p-3 text-white transition-colors hover:bg-white/10 sm:right-6">
              <ChevronRight className="h-10 w-10" />
            </button>
          )}
        </div>
      )}

      <div className="store-product-detail__panel flex flex-col overflow-hidden rounded-2xl md:flex-row">
        {/* Image Gallery area */}
        <div className="store-product-gallery product-photo-surface relative flex w-full flex-col items-center p-4 sm:p-6 md:w-1/2 lg:p-8">
          
          {/* Main Image */}
          <div className="relative flex aspect-square w-full items-center justify-center" role="group" aria-label="Product image gallery">
            {images.length > 0 ? (
              <button type="button" onClick={openFullscreen} className="store-gallery-main group flex h-full w-full items-center justify-center" aria-label={`Open full-size image of ${product.name}`}>
                <img
                  key={imgIndex}
                  src={images[imgIndex]}
                  alt={product.name}
                  loading={imgIndex === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={imgIndex === 0 ? 'high' : 'auto'}
                  className="product-photo h-full w-full object-contain"
                />
                <span className="store-gallery-hint">Tap to enlarge</span>
              </button>
            ) : (
              <ProductPlaceholder className="h-full w-full rounded-xl" />
            )}
            
            {images.length > 1 && (
              <>
                <button 
                  type="button"
                  onClick={prevImg}
                  aria-label="Previous product image"
                  className="store-gallery-control absolute left-2"
                >
                  <ChevronRight className="h-5 w-5 rotate-180 text-black" />
                </button>
                <button 
                  type="button"
                  onClick={nextImg}
                  aria-label="Next product image"
                  className="store-gallery-control absolute right-2"
                >
                  <ChevronRight className="h-5 w-5 text-black" />
                </button>
              </>
            )}
          </div>

          {/* Thumbnails */}
          {images.length > 1 && (
            <div className="mt-4 flex w-full justify-start gap-3 overflow-x-auto pb-2 sm:justify-center" aria-label="Choose product image">
              {images.map((img, idx) => (
                <button 
                  key={idx}
                  type="button"
                  onClick={() => setImgIndex(idx)}
                  aria-label={`Show product photo ${idx + 1}`}
                  aria-pressed={imgIndex === idx}
                  className={`store-gallery-thumbnail h-16 w-16 shrink-0 overflow-hidden rounded-lg ${imgIndex === idx ? 'is-active' : ''}`}
                >
                  <img src={img} alt="" loading="lazy" decoding="async" className="product-photo h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {isOutOfStock && (
             <div className="absolute top-4 left-4 bg-red-100 text-red-700 px-3 py-1 rounded-md font-bold text-sm tracking-wide shadow-sm">
               OUT OF STOCK
             </div>
          )}
        </div>
        
        {/* Product Info */}
        <div className="store-product-info flex w-full flex-col p-5 sm:p-8 lg:w-1/2 lg:p-10">
          <p className="store-eyebrow mb-2 text-sm font-semibold uppercase tracking-wider">{product.category}</p>
          <h1 id="product-title" className="store-section-title mb-3 text-3xl font-semibold tracking-tight lg:text-4xl">{product.name}</h1>
          <p className="store-product-detail__price mb-5 text-2xl font-semibold">{formatMoney(product.price)}</p>
          
          <details className="store-disclosure mb-6">
            <summary>About this appliance</summary>
            <p className="store-muted mt-3 text-sm leading-6">{product.description || 'Contact our support team if you need more information about this appliance.'}</p>
          </details>
          
          <div className="mt-auto space-y-6">
            <div className="store-purchase-row flex flex-wrap items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-[4.75rem] shrink-0">
                  <span className="store-field-label block text-sm font-semibold">Quantity</span>
                  <span className="store-muted mt-1 block text-xs">{product.stock} available</span>
                </div>
                <div className="store-quantity-control flex shrink-0 items-center overflow-hidden rounded-lg">
                <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity" className="store-quantity-button">−</button>
                <span className="store-quantity-value w-12 text-center font-medium" aria-live="polite">{qty}</span>
                <button 
                  type="button"
                  onClick={() => setQty(Math.min(product.stock, qty + 1))} 
                  disabled={qty >= product.stock}
                  aria-label="Increase quantity"
                  className="store-quantity-button"
                >
                  +
                </button>
                </div>
              </div>
              <Suspense fallback={null}>
                <ProductChatWidget productId={product.id} productName={product.name} user={user} inlineTrigger />
              </Suspense>
            </div>
            
            <button 
              onClick={() => addToCart(product.id, qty)}
              disabled={isOutOfStock}
              className={`store-button-primary add-to-cart-button w-full py-4 text-lg font-semibold ${
                isOutOfStock 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none' 
                  : 'bg-[#111214] text-white hover:bg-[#24272A] hover:shadow-lg active:scale-[0.98]'
              }`}
            >
              {isOutOfStock ? 'Currently Unavailable' : 'Add to Cart'}
            </button>
            
            <div className="store-product-benefits grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-[#9C6644]"/> 3 Months Warranty</div>
              <div className="flex items-center gap-2"><Package className="h-4 w-4 shrink-0 text-[#9C6644]"/> Delivery is offered</div>
              <div className="flex items-center gap-2 sm:col-span-2"><Trash2 className="h-4 w-4 shrink-0 text-[#9C6644]"/> Old appliance haul-away offered</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const StoreCheckout = () => {
  const { cart, cartTotal, placeOrder, navigate } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('stripe');
  
  const [formData, setFormData] = useState({ name: '', email: '', address: '', phone: '' });

  if (orderComplete) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-[#E5E4E0] flex flex-col items-center">
          <CheckCircle2 className="h-20 w-20 text-green-500 mb-6" />
          <h2 className="text-3xl font-bold mb-2">Order Confirmed!</h2>
          <p className="text-[#4A5568] mb-6">Thank you for your purchase. Your order has been placed successfully.</p>
          <div className="bg-[#F4F3EF] p-4 rounded-lg w-full max-w-sm mb-8">
            <p className="text-sm text-[#858884] uppercase tracking-wider mb-1">Order Number</p>
            <p className="font-mono font-bold text-lg text-[#111214]">{orderId}</p>
          </div>
          <button onClick={() => navigate('/')} className="bg-[#111214] text-white px-8 py-3 rounded-lg font-medium hover:bg-[#24272A] transition-colors">
            Return to Store
          </button>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Checkout Error</h2>
        <p className="mb-6">Your cart is empty.</p>
        <button onClick={() => navigate('/products')} className="bg-[#9C6644] text-white px-6 py-2 rounded-lg">Browse Products</button>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const newOrderId = await placeOrder(formData);
      if (newOrderId) {
        setOrderId(newOrderId);
        setOrderComplete(true);
      } else {
        toast.error('Error processing order. Check stock and your Supabase permissions.');
      }
    } catch (error) {
      toast.error(error.message || 'Error processing order.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h2 className="text-3xl font-bold tracking-tight mb-8">Secure Checkout</h2>
      
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-2/3">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-[#E5E4E0] p-6 sm:p-8">
            <h3 className="text-xl font-semibold mb-6 pb-2 border-b border-[#E5E4E0] flex items-center gap-2">
              <User className="h-5 w-5 text-[#9C6644]" /> Customer Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-[#4A5568] mb-2">Full Name *</label>
                <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A5568] mb-2">Email Address *</label>
                <input required type="email" value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none transition-all" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[#4A5568] mb-2">Delivery Address *</label>
                <input required type="text" value={formData.address} onChange={e=>setFormData({...formData, address: e.target.value})} className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none transition-all" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[#4A5568] mb-2">Phone Number *</label>
                <input required type="tel" value={formData.phone} onChange={e=>setFormData({...formData, phone: e.target.value})} className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none transition-all" placeholder="(555) 123-4567" />
              </div>
            </div>

            <h3 className="text-xl font-semibold mb-6 pb-2 border-b border-[#E5E4E0] flex items-center gap-2 mt-8">
              <Lock className="h-5 w-5 text-[#9C6644]" /> Payment Method
            </h3>
            <div className="space-y-4 mb-8">
               {['stripe', 'venmo', 'cashapp', 'cash'].map(method => (
                 <div 
                   key={method} 
                   onClick={() => setPaymentMethod(method)} 
                   className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${paymentMethod === method ? 'border-[#9C6644] bg-[#9C6644]/5' : 'border-[#E5E4E0] hover:bg-[#F4F3EF]'}`}
                 >
                    <input type="radio" name="payment" checked={paymentMethod === method} readOnly className="accent-[#9C6644]" />
                    <span className="font-medium text-[#111214]">
                      {method === 'stripe' && 'Credit / Debit Card (Stripe)'}
                      {method === 'venmo' && 'Venmo'}
                      {method === 'cashapp' && 'Cash App'}
                      {method === 'cash' && 'Cash on Delivery'}
                    </span>
                 </div>
               ))}
            </div>

            <button 
              type="submit" 
              disabled={isProcessing}
              className="w-full bg-[#111214] hover:bg-[#24272A] text-white py-4 rounded-xl font-bold text-lg transition-colors shadow-md flex justify-center items-center gap-2 disabled:opacity-70"
            >
              {isProcessing ? <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : `Pay ${formatMoney(cartTotal)}`}
            </button>
          </form>
        </div>

        <div className="w-full lg:w-1/3">
          <div className="bg-[#F4F3EF] rounded-xl border border-[#E5E4E0] p-6 sticky top-24">
            <h3 className="text-lg font-bold mb-4 border-b border-[#E5E4E0] pb-2">Order Summary</h3>
            <div className="space-y-4 mb-6 max-h-96 overflow-y-auto pr-2">
              {cart.map(item => (
                <div key={item.productId} className="flex justify-between text-sm">
                  <div className="flex gap-3">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-12 h-12 object-cover rounded bg-white border border-[#E5E4E0]" />
                    ) : (
                      <ProductPlaceholder className="w-12 h-12 rounded border border-[#E5E4E0]" />
                    )}
                    <div>
                      <p className="font-medium line-clamp-1">{item.name}</p>
                      <p className="text-[#858884]">Qty: {item.quantity}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-right">{formatMoney(item.price * item.quantity)}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-[#E5E4E0] pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-[#4A5568]">
                <span>Subtotal</span>
                <span>{formatMoney(cartTotal)}</span>
              </div>
              <div className="flex justify-between text-[#4A5568]">
                <span>Delivery (Estimated)</span>
                <span>Free</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t border-[#E5E4E0] mt-2">
                <span>Total</span>
                <span className="text-[#9C6644]">{formatMoney(cartTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// ADMIN (HQ-OPERATIONS) COMPONENTS
// Theme: "Charcoal Dashboard" (Dark bg, Off-white text, Copper accents)
// STRICTLY SEPARATE VISUAL IDENTITY from Storefront
// ============================================================================

const AdminGlobalSearch = ({ navigate, adminBasePath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (!isOpen || value.length < 2) {
      setResults([]);
      setIsSearching(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      const pattern = `%${value.replace(/[\\%_]/g, '\\$&')}%`;
      const [productsResult, ordersResult, messagesResult] = await Promise.all([
        supabase.from('products').select('id, name, category').ilike('name', pattern).limit(4),
        supabase.from('orders').select('id, customer_name, status').ilike('customer_name', pattern).order('created_at', { ascending: false }).limit(4),
        supabase.from('messages').select('session_id, product_id, product_name, content, created_at').ilike('content', pattern).order('created_at', { ascending: false }).limit(4)
      ]);
      if (!active) return;

      const route = (name, search) => `${adminBasePath}/${name}${search}` || `/${name}${search}`;
      setResults([
        ...(productsResult.data || []).map((row) => ({ type: 'product', key: `product:${row.id}`, title: row.name, detail: row.category || 'Appliance', target: route('products', `?search=${encodeURIComponent(row.name)}`) })),
        ...(ordersResult.data || []).map((row) => ({ type: 'order', key: `order:${row.id}`, title: row.customer_name || 'Customer order', detail: `${row.status || 'Pending'} · ${String(row.id).slice(0, 8)}`, target: route('orders', `?search=${encodeURIComponent(row.customer_name || row.id)}`) })),
        ...(messagesResult.data || []).map((row) => ({ type: 'chat', key: `chat:${row.session_id}:${row.product_id}`, title: row.product_name || 'Product support chat', detail: row.content, target: route('chats', `?thread=${encodeURIComponent(`${row.session_id}::${row.product_id}`)}`) }))
      ]);
      setIsSearching(false);
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [adminBasePath, isOpen, query]);

  const selectResult = (target) => {
    setIsOpen(false);
    setQuery('');
    navigate(target);
  };

  return (
    <>
      <button type="button" onClick={() => { setIsOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#3A3D40] bg-[#0B0B0C] px-3 text-sm text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]" aria-label="Search products, orders, and support messages">
        <Search className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">Search</span><kbd className="hidden rounded border border-[#3A3D40] px-1.5 py-0.5 text-[10px] text-[#858884] sm:inline">Ctrl K</kbd>
      </button>
      {isOpen && <div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/60 px-3 pt-[max(4.5rem,env(safe-area-inset-top))] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
        <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#3A3D40] bg-[#17191C] shadow-2xl" role="dialog" aria-modal="true" aria-label="Search administrator data">
          <div className="flex items-center gap-3 border-b border-[#2A2D30] px-4"><Search className="h-5 w-5 shrink-0 text-[#C08457]" aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products, customers, orders, messages…" className="min-h-14 min-w-0 flex-1 bg-transparent text-sm text-[#F1F3EF] outline-none placeholder:text-[#858884]" aria-label="Search products, customers, orders, and messages" /><button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-[#858884] hover:bg-[#24272A] hover:text-white" aria-label="Close search"><X className="h-4 w-4" /></button></div>
          <div className="max-h-[min(60dvh,30rem)] overflow-y-auto p-2">
            {query.trim().length < 2 ? <p className="px-3 py-6 text-sm text-[#858884]">Type at least two characters to search live Supabase records.</p> : isSearching ? <p className="px-3 py-6 text-sm text-[#858884]">Searching…</p> : results.length ? results.map((result) => {
              const Icon = result.type === 'product' ? Package : result.type === 'order' ? ShoppingCart : MessagesSquare;
              return <button key={result.key} type="button" onClick={() => selectResult(result.target)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#24272A] focus:bg-[#24272A] focus:outline-none"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#24272A] text-[#C08457]"><Icon className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#F1F3EF]">{result.title}</span><span className="mt-0.5 block truncate text-xs text-[#858884]">{result.detail}</span></span><span className="text-[10px] uppercase tracking-wide text-[#777B78]">{result.type}</span></button>;
            }) : <p className="px-3 py-6 text-sm text-[#858884]">No matching products, orders, or support messages.</p>}
          </div>
          <div className="border-t border-[#2A2D30] px-4 py-2 text-[11px] text-[#777B78]">Results are limited to records available to this administrator session.</div>
        </section>
      </div>}
    </>
  );
};

const AdminLayout = ({ children }) => {
  const { user, logout, navigate, currentRoute, theme, toggleTheme, adminBasePath } = useContext(AppContext);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({ support: true, system: true });
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const logoutRef = useRef(logout);
  const storefrontUrl = import.meta.env.VITE_STOREFRONT_URL || (isAdminApp ? 'https://wenappliances.vercel.app' : '/');

  useEffect(() => { logoutRef.current = logout; }, [logout]);

  useEffect(() => {
    const handleConnection = (event) => setConnectionStatus(event.detail?.status || 'checking');
    window.addEventListener('wen:admin-connection-status', handleConnection);
    return () => window.removeEventListener('wen:admin-connection-status', handleConnection);
  }, []);

  useEffect(() => {
    let warningTimer;
    let logoutTimer;
    const resetIdleTimers = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
      setShowIdleWarning(false);
      warningTimer = window.setTimeout(() => setShowIdleWarning(true), 29 * 60 * 1000);
      logoutTimer = window.setTimeout(() => {
        toast.error('You were signed out after 30 minutes without activity.');
        void logoutRef.current();
      }, 30 * 60 * 1000);
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((eventName) => window.addEventListener(eventName, resetIdleTimers, { passive: true }));
    window.addEventListener('wen:admin-activity', resetIdleTimers);
    resetIdleTimers();
    return () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimers));
      window.removeEventListener('wen:admin-activity', resetIdleTimers);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refreshActiveOrderCount = async () => {
      const [pendingResult, confirmedResult] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['Confirmed', 'Processing', 'Paid & Confirmed'])
      ]);
      if (!active || pendingResult.error || confirmedResult.error) return;
      setActiveOrderCount((pendingResult.count || 0) + (confirmedResult.count || 0));
    };

    refreshActiveOrderCount();
    const ordersChannel = supabase
      .channel(`admin-order-indicator-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refreshActiveOrderCount)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    if (!isMobileNavOpen) return undefined;
    const closeMenuOnEscape = (event) => {
      if (event.key === 'Escape') setIsMobileNavOpen(false);
    };
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => window.removeEventListener('keydown', closeMenuOnEscape);
  }, [isMobileNavOpen]);

  useEffect(() => {
    const groupId = currentRoute.includes('chats') || currentRoute.includes('members')
      ? 'support'
      : currentRoute.includes('tools') ? 'system' : 'operations';
    setCollapsedGroups((current) => ({ ...current, [groupId]: false }));
  }, [currentRoute]);
  
  const navGroups = [
    { id: 'operations', label: 'Operations', items: [
      { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'products', label: 'Inventory', icon: Package },
      { id: 'orders', label: 'Orders', icon: ShoppingCart }
    ] },
    { id: 'support', label: 'Customers & support', items: [
      { id: 'chats', label: 'Product chats', icon: MessagesSquare },
      { id: 'members', label: 'Members', icon: Users }
    ] },
    { id: 'system', label: 'System', items: [
      { id: 'tools', label: 'Admin tools', icon: Settings }
    ] }
  ];

  const currentPageLabel = navGroups.flatMap((group) => group.items).find((item) => (
    currentRoute.includes(item.id)
    || ((adminBasePath ? currentRoute === adminBasePath : currentRoute === '/') && item.id === 'dashboard')
  ))?.label || (currentRoute.includes('new-product') ? 'New product' : 'Admin workspace');

  const renderNavigation = () => navGroups.map((group) => {
    const isCollapsed = Boolean(collapsedGroups[group.id]);
    return <section key={group.id} className="admin-nav-group space-y-1">
      <button type="button" onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))} className="admin-nav-group-toggle flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#858884] transition hover:bg-[#1D2023] hover:text-[#B8BAB7]" aria-expanded={!isCollapsed}>
        <span>{group.label}</span><ChevronRight className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} aria-hidden="true" />
      </button>
      {!isCollapsed && group.items.map((item) => {
        const path = `${adminBasePath}/${item.id}` || `/${item.id}`;
        const adminRoot = adminBasePath ? currentRoute === adminBasePath : currentRoute === '/';
        const active = currentRoute.includes(item.id) || (adminRoot && item.id === 'dashboard');
        return <button key={item.id} type="button" onClick={() => navigate(path)} aria-current={active ? 'page' : undefined} className={`admin-nav-item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? 'is-active bg-[#9C6644] text-white' : 'text-[#B8BAB7] hover:bg-[#24272A] hover:text-[#F1F1EF]'}`}>
          <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"><span className="truncate">{item.label}</span>{item.id === 'orders' && activeOrderCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#9C6644] px-1.5 py-0.5 text-[10px] font-bold text-white">{activeOrderCount}</span>}</span>
        </button>;
      })}
    </section>;
  });

  const mobileItems = [navGroups[0].items[0], navGroups[0].items[2], navGroups[0].items[1], navGroups[1].items[0]];
  const renderMoreNavigation = () => navGroups.map((group) => {
    const items = group.items.filter((item) => !['dashboard', 'orders', 'products', 'chats'].includes(item.id));
    if (!items.length) return null;
    return <section key={group.id} className="admin-mobile-menu__group">
      <p className="admin-mobile-menu__label">{group.label}</p>
      {items.map((item) => {
        const path = `${adminBasePath}/${item.id}` || `/${item.id}`;
        const active = currentRoute.includes(item.id);
        return <button key={item.id} type="button" onClick={() => { setIsMobileNavOpen(false); navigate(path); }} aria-current={active ? 'page' : undefined} className={`admin-mobile-menu__link ${active ? 'is-active' : ''}`}>
          <item.icon className="h-4 w-4" aria-hidden="true" />{item.label}<ChevronRight className="ml-auto h-4 w-4" aria-hidden="true" />
        </button>;
      })}
    </section>;
  });

  return (
    <div className="admin-app motion-fade-in min-h-screen bg-[#0B0B0C] text-[#F1F1EF] flex font-sans selection:bg-[#9C6644]/30">
      {/* Sidebar */}
      <aside className="admin-sidebar sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[#24272A] bg-[#17191C] lg:flex">
        <div className="admin-sidebar__brand p-6 border-b border-[#24272A]">
          <Logo dark={theme === 'dark'} />
        </div>
        <nav className="admin-sidebar__nav grow space-y-4 overflow-y-auto px-3 py-5" aria-label="Administrator navigation">
          {renderNavigation()}
        </nav>
        <div className="admin-sidebar__footer p-4 border-t border-[#24272A] flex flex-col gap-4">
           <div className="flex items-center gap-3 px-2">
             <div className="h-8 w-8 rounded-full bg-[#24272A] flex items-center justify-center text-[#9C6644] font-bold text-xs">{user.name.charAt(0)}</div>
             <div className="flex flex-col">
               <span className="text-sm font-medium text-[#F1F3EF]">{user.name}</span>
               <span className="text-[10px] text-[#858884] uppercase tracking-wider">{user.role}</span>
             </div>
           </div>
           <button type="button" onClick={logout} className="admin-signout flex min-h-10 items-center gap-2 text-sm text-[#858884] hover:text-red-400 px-2 py-1 transition-colors">
              <LogOut className="h-4 w-4" /> Terminate Session
           </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="admin-main flex min-h-screen min-w-0 grow flex-col overflow-hidden lg:h-screen">
        <header className="admin-topbar sticky top-0 z-[110] flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[#24272A] bg-[#17191C]/95 px-3 backdrop-blur-md sm:px-5 lg:px-8">
           <div className="flex min-w-0 items-center gap-2 text-sm text-[#858884]">
             <span className="admin-topbar__lock inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#9C6644]/30 bg-[#9C6644]/10 text-[#C08457]" aria-hidden="true"><Lock className="h-4 w-4" /></span>
             <span className="admin-topbar__mobile-title min-w-0 max-w-[40vw] truncate text-xs font-semibold text-[#F1F3EF] sm:text-sm xl:hidden">{currentPageLabel}</span>
             <span className="hidden min-w-0 xl:block"><span className="block truncate text-xs font-semibold text-[#F1F3EF]">Wen Appliances Admin</span><span className="mt-0.5 block truncate text-[10px] text-[#858884]">{currentPageLabel}</span></span>
           </div>
             <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
             <span className="admin-connection-pill hidden items-center gap-2 rounded-full border border-[#3A3D40] px-2.5 py-2 text-[11px] text-[#B8BAB7] xl:inline-flex" title={connectionStatus === 'online' ? 'Supabase is reachable' : connectionStatus === 'checking' ? 'Checking Supabase connectivity' : 'Connection needs attention'}><span className={`h-2 w-2 rounded-full ${connectionStatus === 'online' ? 'bg-emerald-400' : connectionStatus === 'checking' ? 'bg-[#C08457]' : 'bg-red-400'}`} />{connectionStatus === 'online' ? 'Connected' : connectionStatus === 'checking' ? 'Checking' : 'Connection issue'}</span>
             <AdminGlobalSearch navigate={navigate} adminBasePath={adminBasePath} />
             <button type="button" onClick={() => navigate(`${adminBasePath}/new-product` || '/new-product')} className="admin-add-button hidden min-h-10 items-center gap-2 rounded-lg bg-[#9C6644] px-3 text-sm font-semibold text-white transition hover:bg-[#8A5A3C] sm:inline-flex"><Plus className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">Add appliance</span><span className="xl:hidden">Add</span></button>
             <ChatNotificationBell />
             <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
             <a href={storefrontUrl} className="admin-store-link inline-flex min-h-10 items-center rounded border border-[#4A5568]/30 bg-[#24272A] px-2.5 text-xs transition-colors hover:bg-[#1D2023] sm:px-3">
               <span className="hidden sm:inline">View Public Storefront</span>
               <span className="sm:hidden">Store</span>
             </a>
             <button type="button" onClick={logout} className="hidden min-h-10 items-center gap-2 rounded-lg border border-[#3A3D40] px-2.5 text-xs text-[#B8BAB7] transition hover:border-red-500/40 hover:text-red-300 xl:inline-flex" title={`Signed in as ${user.name}; select to sign out`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#24272A] font-bold text-[#C08457]">{user.name.charAt(0).toUpperCase()}</span><span className="max-w-24 truncate">{user.name}</span></button>
           </div>
        </header>
         <PullToRefresh
           className="admin-content p-4 pb-24 sm:p-8 sm:pb-24 lg:pb-8"
           onRefresh={() => window.dispatchEvent(new CustomEvent('wen:admin-refresh'))}
         >
           <div className="mx-auto max-w-6xl">
             {children}
           </div>
         </PullToRefresh>
      </main>
      <nav className="admin-mobile-nav lg:hidden" aria-label="Primary administrator navigation">
        {mobileItems.map((item) => {
          const path = `${adminBasePath}/${item.id}` || `/${item.id}`;
          const adminRoot = adminBasePath ? currentRoute === adminBasePath : currentRoute === '/';
          const active = currentRoute.includes(item.id) || (adminRoot && item.id === 'dashboard');
          return <button key={item.id} type="button" onClick={() => navigate(path)} aria-current={active ? 'page' : undefined} className={`admin-mobile-nav__item ${active ? 'is-active' : ''}`}>
            <span className="admin-mobile-nav__icon-wrap"><item.icon className="h-5 w-5" aria-hidden="true" />{item.id === 'orders' && activeOrderCount > 0 && <span className="admin-mobile-nav__badge">{activeOrderCount > 99 ? '99+' : activeOrderCount}</span>}</span>
            <span>{item.id === 'dashboard' ? 'Home' : item.id === 'products' ? 'Stock' : item.id === 'chats' ? 'Chats' : item.label}</span>
          </button>;
        })}
        <button type="button" onClick={() => setIsMobileNavOpen((open) => !open)} aria-expanded={isMobileNavOpen} aria-label={isMobileNavOpen ? 'Close more administrator options' : 'Open more administrator options'} className={`admin-mobile-nav__item ${isMobileNavOpen || currentRoute.includes('members') || currentRoute.includes('tools') ? 'is-active' : ''}`}>
          {isMobileNavOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}<span>More</span>
        </button>
      </nav>
      {isMobileNavOpen && <>
        <button type="button" onClick={() => setIsMobileNavOpen(false)} className="admin-mobile-menu__backdrop" aria-label="Close more administrator options" />
        <nav className="admin-mobile-menu" aria-label="More administrator options">
          <div className="admin-mobile-menu__header"><span>More options</span><button type="button" onClick={() => setIsMobileNavOpen(false)} aria-label="Close menu"><X className="h-4 w-4" aria-hidden="true" /></button></div>
          {renderMoreNavigation()}
          <a href={storefrontUrl} className="admin-mobile-menu__link"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#24272A] text-[#C08457]"><ExternalLink className="h-4 w-4" aria-hidden="true" /></span>View public storefront<ChevronRight className="ml-auto h-4 w-4" aria-hidden="true" /></a>
          <button type="button" onClick={() => { setIsMobileNavOpen(false); navigate(`${adminBasePath}/new-product` || '/new-product'); }} className="admin-mobile-menu__primary"><Plus className="h-4 w-4" aria-hidden="true" />Add appliance</button>
          <div className="admin-mobile-menu__account"><span className="admin-mobile-menu__avatar">{user.name.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><strong>{user.name}</strong><small>{user.role}</small></span><button type="button" onClick={() => void logout()} aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" aria-hidden="true" /></button></div>
        </nav>
      </>}
      {showIdleWarning && <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="idle-warning-title"><section className="w-full max-w-sm rounded-2xl border border-[#3A3D40] bg-[#17191C] p-5 shadow-2xl"><p className="text-xs font-semibold uppercase tracking-wider text-[#C08457]">Session security</p><h2 id="idle-warning-title" className="mt-2 text-lg font-semibold text-[#F1F3EF]">Still working?</h2><p className="mt-2 text-sm leading-6 text-[#B8BAB7]">For your security, you’ll be signed out after 30 minutes of inactivity. Continue the session to stay signed in.</p><div className="mt-5 flex gap-3"><button type="button" onClick={() => window.dispatchEvent(new Event('wen:admin-activity'))} className="min-h-11 flex-1 rounded-lg bg-[#9C6644] px-4 text-sm font-semibold text-white hover:bg-[#8A5A3C]">Continue session</button><button type="button" onClick={() => void logout()} className="min-h-11 rounded-lg border border-[#3A3D40] px-4 text-sm text-[#B8BAB7] hover:text-white">Sign out</button></div></section></div>}
    </div>
  );
};

const AdminRouter = ({ route }) => {
  if (route.includes('new-product')) return <AdminNewProduct />;
  if (route.includes('members')) return <SupabaseAdminMembers />;
  if (route.includes('chats')) return <AdminProductChat />;
  if (route.includes('tools')) return <AdminTools />;
  if (route.includes('products')) return <AdminProducts />;
  if (route.includes('orders')) return <SupabaseAdminOrders />;
  return <AdminDashboard />;
};

const AdminRouteLoading = () => (
  <div className="mx-auto flex min-h-64 max-w-6xl items-center justify-center p-8" role="status" aria-live="polite">
    <span className="text-sm text-[#858884]">Loading administrator tools…</span>
  </div>
);

const StoreRouteLoading = () => (
  <div className="mx-auto flex min-h-64 max-w-6xl items-center justify-center px-4 py-16" role="status" aria-live="polite">
    <span className="text-sm text-[var(--store-muted)]">Loading…</span>
  </div>
);

const AdminNewProduct = () => {
  const { navigate, loadProducts, adminBasePath } = useContext(AppContext);

  return (
    <SecureProductEditor
      onSaved={async () => {
        await loadProducts();
        navigate(`${adminBasePath}/products` || '/products');
      }}
    />
  );
};

const AdminDashboard = () => {
  const { navigate, adminBasePath } = useContext(AppContext);
  const [orders, setOrders] = useState([]);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      const [summaryResult, ordersResult, lowStockResult] = await Promise.all([
        supabase.rpc('admin_dashboard_summary'),
        supabase.from('orders')
          .select('id, customer_name, total_amount, status, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('products')
          .select('id, name, stock')
          .lte('stock', 10)
          .order('stock', { ascending: true })
          .limit(8)
      ]);

      if (!active) return;

      const summaryMissing = summaryResult.error && ['PGRST202', '42883'].includes(summaryResult.error.code);
      const failures = [ordersResult, lowStockResult]
        .filter((result) => result.error)
        .map((result) => result.error.message);
      if (summaryResult.error && !summaryMissing) failures.push(summaryResult.error.message);
      setOrders(ordersResult.data ?? []);
      setLowStockProducts(lowStockResult.data ?? []);
      setSummary(summaryResult.error ? null : summaryResult.data);
      setError(failures.join(' ') || (summaryMissing
        ? 'Dashboard summary is unavailable until the Supabase admin dashboard migration is applied.'
        : ''));
      setLastUpdated(new Date());
      setLoading(false);
    };

    loadDashboard();
    window.addEventListener('wen:admin-refresh', loadDashboard);
    const dashboardChannel = supabase
      .channel(`admin-dashboard-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, loadDashboard)
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('wen:admin-refresh', loadDashboard);
      supabase.removeChannel(dashboardChannel);
    };
  }, []);

  return (
    <div className="admin-dashboard space-y-8 animate-in fade-in duration-500">
      <div className="admin-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C08457]">Wen Appliances · Operations</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-[#858884]">A live view of orders, inventory, and customer support.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lastUpdated && <span className="text-xs text-[#858884]">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button type="button" onClick={() => navigate(`${adminBasePath}/new-product` || '/new-product')} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#9C6644] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#8A5A3C]"><Plus className="h-4 w-4" aria-hidden="true" /> Add appliance</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      <div className="admin-stat-grid motion-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard title="Collected · last 30 days" value={summary ? formatMoney(summary.revenue_30d) : '—'} icon={DollarSign} />
        <StatCard title="Awaiting confirmation" value={summary?.pending_orders_30d ?? '—'} icon={ShoppingCart} color="wen-warning-foreground" />
        <StatCard title="Confirmed · in progress" value={summary?.confirmed_orders_30d ?? '—'} icon={TrendingUp} color="text-emerald-400" />
        <StatCard title="Unread support messages" value={summary?.unread_customer_messages ?? '—'} icon={MessagesSquare} color="text-[#C08457]" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="admin-dashboard-panel col-span-2 overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#24272A] p-5"><div><h3 className="font-semibold text-[#F1F3EF]">Recent orders</h3><p className="mt-1 text-xs text-[#858884]">Latest order activity from Supabase.</p></div><button type="button" onClick={() => navigate(`${adminBasePath}/orders` || '/orders')} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-[#C08457] hover:underline">Open orders <ChevronRight className="h-4 w-4" aria-hidden="true" /></button></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[#0B0B0C] text-xs uppercase tracking-wider text-[#858884]"><tr><th className="px-5 py-3 font-medium">Order ID</th><th className="px-5 py-3 font-medium">Customer</th><th className="px-5 py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-[#24272A]">
                {orders.slice(0, 5).map((order) => <tr key={order.id} className="transition-colors hover:bg-[#1D2023]"><td className="px-5 py-4 font-mono text-xs text-[#B8BAB7]">{order.id}</td><td className="px-5 py-4 text-[#F1F1EF]">{order.customer_name || 'Unnamed customer'}</td><td className="px-5 py-4 font-medium text-[#F1F1EF]">{formatMoney(order.total_amount)}</td><td className="px-5 py-4"><StatusBadge status={normalizeAdminOrderStatus(order.status)} /></td></tr>)}
                {!loading && !orders.length && <tr><td colSpan="4" className="p-8 text-center text-sm text-[#858884]">No orders found in the database.</td></tr>}
                {loading && <tr><td colSpan="4" className="p-8 text-center text-sm text-[#858884]">Loading live orders...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-dashboard-panel overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#24272A] p-5"><h3 className="flex items-center gap-2 font-semibold text-[#F1F3EF]"><AlertTriangle className="admin-stock-icon h-4 w-4" /> Stock alerts</h3><button type="button" onClick={() => navigate(`${adminBasePath}/products` || '/products')} className="text-xs font-semibold text-[#C08457] hover:underline">Manage inventory</button></div>
          <div className="space-y-4 p-5">
            {lowStockProducts.slice(0, 8).map((product) => <div key={product.id} className="flex items-start justify-between gap-3 border-b border-[#24272A] pb-4 last:border-0 last:pb-0"><div className="min-w-0"><p className="line-clamp-1 text-sm font-medium text-[#F1F3EF]">{product.name || 'Unnamed appliance'}</p><p className="mt-1 text-xs text-[#858884]">{Number(product.stock || 0) <= 0 ? 'Out of stock' : 'Low stock'}</p></div><div className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${Number(product.stock || 0) <= 0 ? 'bg-red-500/20 text-red-300' : 'wen-warning-badge'}`}>{Number(product.stock || 0)} left</div></div>)}
            {!loading && !lowStockProducts.length && <p className="py-4 text-center text-sm text-[#858884]">Inventory levels are healthy.</p>}
            {loading && <p className="py-4 text-center text-sm text-[#858884]">Loading inventory...</p>}
          </div>
          <div className="border-t border-[#24272A] p-5">
            <button type="button" onClick={() => navigate(`${adminBasePath}/chats` || '/chats')} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-[#3A3D40] px-3 py-2 text-left text-sm text-[#F1F3EF] transition hover:border-[#9C6644] hover:bg-[#0B0B0C]">
              <span className="flex items-center gap-2"><MessagesSquare className="h-4 w-4 text-[#C08457]" aria-hidden="true" /> Support inbox</span>
              <span className="rounded-full bg-[#9C6644] px-2 py-0.5 text-xs font-bold text-white">{summary?.unread_customer_messages ?? '—'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, trend, color = "text-[#F1F1EF]" }) => (
  <div className="admin-stat-card bg-[#17191C] p-6 rounded-xl border border-[#24272A] shadow-sm flex min-h-32 flex-col justify-between">
    <div className="flex justify-between items-start">
      <p className="text-[#858884] text-sm font-medium">{title}</p>
      <div className="p-2 bg-[#24272A] rounded-lg"><Icon className={`h-4 w-4 ${color === 'text-[#F1F1EF]' ? 'text-[#9C6644]' : color}`} /></div>
    </div>
    <div className="mt-4 flex items-start justify-between gap-3">
      <h3 className={`min-w-0 break-words text-2xl font-bold leading-tight tracking-tight ${color}`}>
        {typeof value === 'string' && value.includes('|')
          ? value.split('|').map((part) => <span key={part.trim()} className="block text-xl sm:text-2xl">{part.trim()}</span>)
          : value}
      </h3>
      {trend && <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">{trend}</span>}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirm deletion">
    <div className="w-full max-w-sm rounded-xl border border-[#24272A] bg-[#17191C] p-6 shadow-2xl">
      <p className="text-sm text-[#F1F1EF]">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-[#B8BAB7] transition-colors hover:bg-[#24272A]">Cancel</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Delete</button>
      </div>
    </div>
  </div>
);

const AdminProducts = () => {
  const { products, saveProduct, deleteProduct, setProductPublished, productsLoading, productsError, productVisibilityAvailable, navigate, adminBasePath } = useContext(AppContext);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [productToDelete, setProductToDelete] = useState(null);
  const [visibilityUpdatingId, setVisibilityUpdatingId] = useState('');
  const [inventorySearch, setInventorySearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const visibilityMigrationRequired = productVisibilityAvailable === false;

  useEffect(() => {
    const onNavigate = (event) => {
      const path = String(event.detail?.path || '');
      if (!path.includes('/products')) return;
      setInventorySearch(new URL(path, window.location.origin).searchParams.get('search') || '');
    };
    window.addEventListener('wen:navigate', onNavigate);
    return () => window.removeEventListener('wen:navigate', onNavigate);
  }, []);

  const categories = useMemo(() => [...new Set(products.map((product) => product.category).filter(Boolean))].sort(), [products]);
  const filteredProducts = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !query || [product.name, product.category, product.sku, product.id]
        .some((value) => String(value || '').toLowerCase().includes(query));
      const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
      const stock = Number(product.stock || 0);
      const matchesStock = stockFilter === 'all'
        || (stockFilter === 'in-stock' && stock > 10)
        || (stockFilter === 'low-stock' && stock > 0 && stock <= 10)
        || (stockFilter === 'out-of-stock' && stock <= 0);
      const matchesVisibility = visibilityFilter === 'all'
        || (visibilityFilter === 'published' && product.is_published !== false)
        || (visibilityFilter === 'hidden' && product.is_published === false);
      return matchesSearch && matchesCategory && matchesStock && matchesVisibility;
    });
  }, [products, inventorySearch, categoryFilter, stockFilter, visibilityFilter]);

  const handleSave = async (updatedProduct) => {
    try {
      await saveProduct(updatedProduct);
      setSaveError('');
      setEditingProduct(null);
    } catch (error) {
      setSaveError(error.message || 'Unable to save this product.');
      throw error;
    }
  };

  const handleDelete = async (product) => {
    setDeletingProductId(product.id);
    void triggerLightHaptic();
    try {
      const result = await deleteProduct(product);
      if (result?.storageWarning) {
        toast.error(`Product deleted, but one or more images could not be removed: ${result.storageWarning}`);
      } else {
        toast.success('Product and its images were deleted completely.');
      }
      void triggerSuccessHaptic();
    } catch (error) {
      const message = error.message || 'Unable to delete this product.';
      if (/foreign key|referenced|violates/i.test(message)) {
        toast.error('This product is linked to an order and cannot be deleted from the catalog history.');
      } else {
        toast.error(message);
      }
    } finally {
      setDeletingProductId(null);
      setProductToDelete(null);
    }
  };

  const handleVisibilityChange = async (product) => {
    if (visibilityMigrationRequired) return;
    const nextIsPublished = product.is_published === false;
    setVisibilityUpdatingId(product.id);
    try {
      await setProductPublished(product.id, nextIsPublished);
      toast.success(nextIsPublished ? 'Product is now visible in the storefront.' : 'Product hidden from the storefront.');
    } catch (error) {
      if (error.code === 'ADMIN_DASHBOARD_MIGRATION_REQUIRED') return;
      toast.error(error.message || 'Unable to update product visibility.');
    } finally {
      setVisibilityUpdatingId('');
    }
  };

  if (editingProduct) {
    return (
      <div className="space-y-4">
        {saveError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">{saveError}</div>}
        <ProductEditor product={editingProduct} onSave={handleSave} onCancel={() => { setSaveError(''); setEditingProduct(null); }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Database</h1>
          <p className="text-[#858884] mt-1 text-sm">Manage inventory, pricing, and catalog metadata.</p>
        </div>
        <button 
          onClick={() => { setSaveError(''); navigate(`${adminBasePath}/new-product` || '/new-product'); }}
          className="bg-[#9C6644] hover:bg-[#8A5A3C] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> New Product
        </button>
      </div>

      {productsError && <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">{productsError}</div>}

      {visibilityMigrationRequired && <div role="alert" className="wen-warning-panel rounded-xl border p-4 text-sm">
        <p className="font-semibold">Product publishing is unavailable until the Supabase migration is applied.</p>
        <p className="wen-warning-muted mt-1">Inventory remains available, but Publish/Hide is disabled. Apply <code className="rounded bg-black/10 px-1.5 py-0.5 font-semibold">20261018000000_admin_dashboard_operations.sql</code> in Supabase, then refresh this page.</p>
      </div>}

      <div className="grid gap-3 rounded-xl border border-[#24272A] bg-[#17191C] p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="relative block md:col-span-2 xl:col-span-1">
          <span className="sr-only">Search inventory</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#858884]" aria-hidden="true" />
          <input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search name or category" className="w-full rounded-lg border border-[#3A3D40] bg-[#0B0B0C] py-2.5 pl-9 pr-3 text-sm text-[#F1F3EF] outline-none placeholder:text-[#777B78] focus:border-[#9C6644]" />
        </label>
        <label>
          <span className="sr-only">Filter by category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="w-full rounded-lg border border-[#3A3D40] bg-[#0B0B0C] px-3 py-2.5 text-sm text-[#F1F3EF] outline-none focus:border-[#9C6644]">
            <option value="all">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by stock</span>
          <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} className="w-full rounded-lg border border-[#3A3D40] bg-[#0B0B0C] px-3 py-2.5 text-sm text-[#F1F3EF] outline-none focus:border-[#9C6644]">
            <option value="all">Any stock level</option>
            <option value="in-stock">In stock (&gt; 10)</option>
            <option value="low-stock">Low stock (1–10)</option>
            <option value="out-of-stock">Out of stock</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by storefront visibility</span>
          <select value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.target.value)} className="w-full rounded-lg border border-[#3A3D40] bg-[#0B0B0C] px-3 py-2.5 text-sm text-[#F1F3EF] outline-none focus:border-[#9C6644]">
            <option value="all">Published and hidden</option>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      </div>

      <div className="bg-[#17191C] border border-[#24272A] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0B0B0C] text-[#858884] uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium w-12">Img</th>
                <th className="px-6 py-4 font-medium">Product / SKU</th>
                <th className="px-6 py-4 font-medium text-right">Price (USD)</th>
                <th className="px-6 py-4 font-medium text-center">Stock</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#24272A]">
              {productsLoading ? (
                <tr><td colSpan="6" className="px-6 py-10 text-center text-[#858884]">Loading products...</td></tr>
              ) : filteredProducts.map(p => (
                <tr key={p.id} className="hover:bg-[#1D2023] transition-colors">
                  <td className="px-6 py-4">
                     {p.image ? <img src={p.image} alt="" className="w-10 h-10 object-cover rounded bg-white" /> : <ProductPlaceholder dark className="w-10 h-10 rounded" />}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-[#F1F1EF]">{p.name}</div>
                    <div className="text-xs font-mono text-[#858884] mt-1">{p.sku} • {p.category}</div>
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-[#F1F1EF]">
                    {formatMoney(p.price)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold ${p.stock <= 0 ? 'bg-red-500/20 text-red-400' : (p.stock < 10 ? 'wen-warning-badge' : 'bg-[#24272A] text-[#B8BAB7]')}`}>
                       {p.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col items-start gap-1.5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${p.is_published === false ? 'bg-[#24272A] text-[#B8BAB7]' : 'bg-emerald-500/10 text-emerald-300'}`}>
                        {p.is_published === false ? 'Hidden' : 'Published'}
                      </span>
                      <span className={`text-[11px] ${Number(p.stock || 0) <= 0 ? 'text-red-300' : Number(p.stock || 0) <= 10 ? 'wen-warning-foreground' : 'text-[#858884]'}`}>
                        {Number(p.stock || 0) <= 0 ? 'Out of stock' : Number(p.stock || 0) <= 10 ? 'Low stock' : 'In stock'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => handleVisibilityChange(p)} disabled={visibilityMigrationRequired || visibilityUpdatingId === p.id} className="rounded-lg p-2 text-[#858884] transition-colors hover:bg-[#24272A] hover:text-[#F1F3EF] disabled:cursor-not-allowed disabled:opacity-50" title={visibilityMigrationRequired ? 'Apply the Supabase admin dashboard migration to change product visibility.' : p.is_published === false ? `Publish ${p.name}` : `Hide ${p.name}`} aria-label={visibilityMigrationRequired ? `Product visibility unavailable until the Supabase migration is applied: ${p.name}` : p.is_published === false ? `Publish ${p.name}` : `Hide ${p.name}`}>
                      {visibilityUpdatingId === p.id ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[#9C6644] border-t-transparent" /> : p.is_published === false ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => setEditingProduct(p)} className="text-[#858884] hover:text-[#9C6644] p-2 transition-colors" title={`Edit ${p.name}`} aria-label={`Edit ${p.name}`}>
                      <Edit className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setProductToDelete(p)} disabled={deletingProductId === p.id} className="p-2 text-[#858884] transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`}>
                      {deletingProductId === p.id ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!productsLoading && filteredProducts.length === 0 && <tr><td colSpan="6" className="px-6 py-10 text-center text-sm text-[#858884]">No products match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {productToDelete && (
        <ConfirmModal
          message={`Delete “${productToDelete.name}” completely? This removes the product and its uploaded images and cannot be undone.`}
          onConfirm={() => handleDelete(productToDelete)}
          onCancel={() => setProductToDelete(null)}
        />
      )}
    </div>
  );
};

const ProductEditor = ({ product, onSave, onCancel }) => {
  const [formData, setFormData] = useState({ ...product });
  const [coverFile, setCoverFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draggedGalleryIndex, setDraggedGalleryIndex] = useState(null);
  
  // Initialize gallery state (max 10 images)
  const [gallery, setGallery] = useState(
    product.gallery && product.gallery.length > 0 
      ? product.gallery 
      : (product.image ? [product.image] : [''])
  );

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value
    }));
  };

  const handleGalleryChange = (index, value) => {
    const newGallery = [...gallery];
    newGallery[index] = value;
    setGallery(newGallery);
  };

  const addGalleryImage = () => {
    if (gallery.length < 10) setGallery([...gallery, '']);
  };

  const removeGalleryImage = (index) => {
    setGallery(gallery.filter((_, i) => i !== index));
  };

  const moveGalleryImage = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= gallery.length) return;
    setGallery((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const makeCoverImage = (index) => {
    if (!gallery[index]?.trim() || index === 0) return;
    moveGalleryImage(index, 0);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    let uploadedCoverPath = '';

    try {
      // Clean up empty URLs and ensure the selected upload becomes the cover image.
      let cleanGallery = gallery.filter(url => url.trim() !== '');

      if (coverFile) {
        const extension = coverFile.name.includes('.') ? `.${coverFile.name.split('.').pop().toLowerCase()}` : '';
        const uniqueId = typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : Math.random().toString(36).slice(2);
        uploadedCoverPath = `products/${Date.now()}-${uniqueId}${extension}`;

        const { error: uploadError } = await supabase.storage
          .from('Wenappliances')
          .upload(uploadedCoverPath, coverFile);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('Wenappliances')
          .getPublicUrl(uploadedCoverPath);
        const newCoverUrl = publicUrlData?.publicUrl;
        if (!newCoverUrl) throw new Error('Could not create a public URL for the new cover photo.');

        cleanGallery = [newCoverUrl, ...cleanGallery.filter(url => url !== newCoverUrl)].slice(0, 10);
      }

      await onSave({
        ...formData,
        images: cleanGallery,
        image: cleanGallery[0] || '',
        gallery: cleanGallery
      });
      setCoverFile(null);
      toast.success('Product details committed successfully.');
    } catch (error) {
      if (uploadedCoverPath) await supabase.storage.from('Wenappliances').remove([uploadedCoverPath]);
      toast.error(error.message || 'Unable to commit product changes.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-[#17191C] border border-[#24272A] rounded-xl shadow-sm animate-in slide-in-from-bottom-4 duration-300">
      <div className="p-6 border-b border-[#24272A] flex justify-between items-center bg-[#0B0B0C] rounded-t-xl">
        <h2 className="text-xl font-bold text-[#F1F1EF]">
          {product.isNew ? 'Create New Product' : `Edit Product: ${product.name || 'Appliance'}`}
        </h2>
        <button onClick={onCancel} className="text-[#858884] hover:text-white transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>
      
      <form onSubmit={handleFormSubmit} className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-[#858884] uppercase tracking-wider border-b border-[#24272A] pb-2">Basic Information</h3>
            <div>
              <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Product Name</label>
              <input required type="text" name="name" value={formData.name} onChange={handleChange} className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Product reference</label>
                <p className="rounded-lg border border-[#24272A] bg-[#0B0B0C] px-4 py-2.5 text-sm text-[#858884]">Managed automatically by Supabase</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Category</label>
                <select required name="category" value={formData.category} onChange={handleChange} className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all">
                  <option value="">Select a category</option>
                  {STORE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Description</label>
              <textarea rows={4} name="description" value={formData.description} onChange={handleChange} className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all resize-none" />
            </div>
          </div>

          <div className="space-y-6">
             <h3 className="text-sm font-semibold text-[#858884] uppercase tracking-wider border-b border-[#24272A] pb-2">Pricing & Inventory</h3>
             <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Selling Price (USD)</label>
                <input required type="number" name="price" value={formData.price} onChange={handleChange} className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Inventory price</label>
                <p className="rounded-lg border border-[#24272A] bg-[#0B0B0C] px-4 py-2.5 text-sm text-[#858884]">Only selling price is stored</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Stock Quantity</label>
                <input required type="number" name="stock" value={formData.stock} onChange={handleChange} className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#B8BAB7] mb-2">Catalog status</label>
                <p className="rounded-lg border border-[#24272A] bg-[#0B0B0C] px-4 py-2.5 text-sm text-[#858884]">Calculated from stock availability</p>
              </div>
            </div>
            
            {/* Image Gallery Section */}
            <div className="space-y-4 pt-2">
               <div className="flex justify-between items-center border-b border-[#24272A] pb-2">
                 <h3 className="text-sm font-semibold text-[#858884] uppercase tracking-wider">Product Gallery ({gallery.length}/10)</h3>
                 {gallery.length < 10 && (
                   <button type="button" onClick={addGalleryImage} className="text-xs flex items-center gap-1 bg-[#24272A] hover:bg-[#9C6644] text-[#F1F1EF] px-2 py-1 rounded transition-colors">
                     <ImagePlus className="h-3 w-3" /> Add Image
                   </button>
                 )}
               </div>

               <div className="rounded-lg border border-dashed border-[#4A5568] bg-[#0B0B0C] p-4">
                 <label className="block text-sm font-medium text-[#B8BAB7]">Change cover photo</label>
                 <input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} className="mt-2 block w-full text-sm text-[#B8BAB7] file:mr-3 file:rounded-md file:border-0 file:bg-[#24272A] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#F1F3EF] hover:file:bg-[#9C6644]" />
                 <p className="mt-2 text-xs text-[#858884]">{coverFile ? `Ready to upload: ${coverFile.name}` : 'Choose a new image to make it the primary cover.'}</p>
               </div>
               
               <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
                 {gallery.map((url, idx) => (
                   <div key={idx} className="flex gap-2 items-start">
                      <div className="grow">
                         <input 
                           type="text" 
                           placeholder={`Image URL ${idx === 0 ? '(Primary Cover)' : ''}`} 
                           value={url} 
                           onChange={(e) => handleGalleryChange(idx, e.target.value)} 
                           className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all text-sm font-mono" 
                         />
                      </div>
                      {gallery.length > 1 && (
                        <button type="button" onClick={() => removeGalleryImage(idx)} className="p-2 text-[#858884] hover:text-red-400 bg-[#24272A] rounded-lg transition-colors shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                   </div>
                 ))}
               </div>
               
               {/* Reorderable Gallery Preview */}
               <div className="mt-4 rounded-lg border border-[#24272A] bg-[#0B0B0C] p-3">
                 <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                   <p className="text-xs text-[#858884]">Drag photos to rearrange them. The first photo is the cover.</p>
                   <span className="text-xs font-semibold text-[#9C6644]">Cover = first photo</span>
                 </div>
                 <div className="grid max-h-80 grid-cols-2 gap-4 overflow-y-auto pr-1 sm:grid-cols-3">
                   {gallery.map((url, idx) => url ? (
                     <div
                       key={`${idx}-${url}`}
                       draggable
                       onDragStart={() => setDraggedGalleryIndex(idx)}
                       onDragOver={(event) => event.preventDefault()}
                       onDrop={() => {
                         if (draggedGalleryIndex !== null) moveGalleryImage(draggedGalleryIndex, idx);
                         setDraggedGalleryIndex(null);
                       }}
                       onDragEnd={() => setDraggedGalleryIndex(null)}
                       className={`group relative overflow-hidden rounded-xl border-2 bg-white transition ${
                         idx === 0 ? 'border-[#9C6644] shadow-lg shadow-[#9C6644]/20' : 'border-[#24272A]'
                       } ${draggedGalleryIndex === idx ? 'opacity-50' : ''}`}
                     >
                       <div className="relative aspect-square">
                         <img src={url} alt={`Preview ${idx + 1}`} className="product-photo h-full w-full object-cover" />
                         <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-bold text-white">
                           {idx === 0 ? 'COVER' : `PHOTO ${idx + 1}`}
                         </span>
                         <span className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white" title="Drag to rearrange">
                           <GripVertical className="h-4 w-4" />
                         </span>
                       </div>
                       <div className="flex items-center justify-between gap-2 bg-[#17191C] p-2">
                         {idx === 0 ? (
                           <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#D8B49A]"><Star className="h-3 w-3 fill-current" /> Cover photo</span>
                         ) : (
                           <button type="button" onClick={() => makeCoverImage(idx)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-[#B8BAB7] hover:bg-[#24272A] hover:text-white">
                             <Star className="h-3 w-3" /> Set cover
                           </button>
                         )}
                         <button type="button" onClick={() => removeGalleryImage(idx)} className="rounded p-1 text-[#858884] transition-colors hover:bg-[#24272A] hover:text-red-400" aria-label={`Remove photo ${idx + 1}`}>
                           <Trash2 className="h-4 w-4" />
                         </button>
                       </div>
                     </div>
                   ) : null)}
                 </div>
               </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-4 pt-6 border-t border-[#24272A]">
          <button type="button" onClick={onCancel} className="px-6 py-2.5 rounded-lg font-medium text-[#B8BAB7] hover:bg-[#24272A] transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="bg-[#9C6644] hover:bg-[#8A5A3C] text-white px-8 py-2.5 rounded-lg font-bold transition-colors shadow-lg disabled:cursor-not-allowed disabled:opacity-60">
            {isSaving ? 'Uploading and committing...' : 'Commit to Database'}
          </button>
        </div>
      </form>
    </div>
  );
};

const AdminOrders = () => {
  const { orders, setOrders } = useContext(AppContext);
  const [receiptOrder, setReceiptOrder] = useState(null);

  const updateOrderStatus = (id, newStatus) => {
    // In a real app, this triggers an audit log and customer notification
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Order Fulfillment</h1>
        <p className="text-[#858884] mt-1 text-sm">Process customer orders and manage fulfillment status.</p>
      </div>

      <div className="bg-[#17191C] border border-[#24272A] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0B0B0C] text-[#858884] uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Order Details</th>
                <th className="px-6 py-4 font-medium">Customer</th>
                <th className="px-6 py-4 font-medium text-right">Total</th>
                <th className="px-6 py-4 font-medium text-center">Status</th>
                <th className="px-6 py-4 font-medium text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#24272A]">
              {orders.map(order => (
                <tr key={order.id} className="hover:bg-[#1D2023] transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-mono text-[#F1F1EF] font-medium">{order.id}</div>
                    <div className="text-xs text-[#858884] mt-1">
                      {new Date(order.date).toLocaleDateString()} • {order.items.length} item(s)
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[#F1F1EF]">
                    {order.customerName}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-[#F1F1EF]">
                    {formatMoney(order.total)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 py-4 text-right flex items-center justify-end gap-3">
                    <button 
                      onClick={() => setReceiptOrder(order)} 
                      title="Download Receipt"
                      className="text-[#858884] hover:text-[#9C6644] transition-colors p-1"
                    >
                      <Download className="h-5 w-5" />
                    </button>
                    <select 
                      value={order.status}
                      onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                      className="bg-[#0B0B0C] border border-[#24272A] text-[#F1F1EF] text-xs rounded px-2 py-1 focus:outline-none focus:border-[#9C6644]"
                    >
                      <option value="PENDING">Pending</option>
                      <option value="PROCESSING">Processing</option>
                      <option value="SHIPPED">Shipped</option>
                      <option value="DELIVERED">Delivered</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                   <td colSpan="5" className="px-6 py-12 text-center text-[#858884]">
                      No orders found in the database.
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Receipt Modal */}
      {receiptOrder && (
        <ReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />
      )}
    </div>
  );
};

const ReceiptModal = ({ order, onClose }) => {
  return (
    <>
      <style>{`
        @media print {
          /* 1. Override layout locks that prevent scrolling/pagination */
          html, body, #root, main, div {
            height: auto !important;
            overflow: visible !important;
            position: static !important;
          }
          /* 2. Hide everything in the app */
          body * { 
            visibility: hidden; 
          }
          /* 3. Reveal ONLY the receipt content */
          #receipt-modal-content, #receipt-modal-content * { 
            visibility: visible; 
          }
          /* 4. Position it perfectly for the printed page */
          #receipt-modal-content {
            position: absolute; 
            left: 0; 
            top: 0; 
            width: 100%; 
            margin: 0; 
            padding: 20px;
            background: white !important; 
            color: black !important; 
            box-shadow: none !important;
            border: none !important;
          }
          /* 5. Hide buttons from the printout */
          .print-hidden { 
            display: none !important; 
          }
        }
      `}</style>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 transition-opacity">
        <div 
          id="receipt-modal-content"
          className="bg-white max-w-lg w-full rounded-xl shadow-2xl overflow-hidden flex flex-col relative max-h-[90vh]"
        >
          {/* Header Controls (Hidden on Print) */}
          <div className="print-hidden flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50 shrink-0">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Printer className="h-4 w-4" /> Order Receipt
            </h3>
            <div className="flex gap-2">
              <button 
                onClick={() => window.print()} 
                className="bg-[#9C6644] text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 hover:bg-[#8A5A3C] transition-colors"
              >
                Print / PDF
              </button>
              <button onClick={onClose} className="p-2 text-gray-500 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Printable Receipt Content */}
          <div className="p-8 relative overflow-y-auto bg-white text-[#111214] grow">
            
            {/* Watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] overflow-hidden z-0">
              <div className="rotate-[-30deg] scale-[2.5] md:scale-[3.5]">
                <Logo dark={false} />
              </div>
            </div>

            <div className="relative z-10">
              {/* Receipt Header */}
              <div className="flex flex-col items-center justify-center mb-8 border-b border-dashed border-gray-300 pb-8">
                 <Logo dark={false} className="scale-125 mb-4" />
                 <h2 className="text-xl font-bold uppercase tracking-widest text-gray-800">Electronic Receipt</h2>
                 <p className="font-mono text-sm text-gray-500 mt-2">{order.id}</p>
              </div>

              {/* Order Info */}
              <div className="space-y-2 mb-8 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Date Issued:</span>
                  <span className="font-medium">{new Date(order.date).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Billed To:</span>
                  <span className="font-medium">{order.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment Status:</span>
                  <span className="font-bold text-[#9C6644] uppercase">{order.status}</span>
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full text-sm mb-8">
                 <thead>
                   <tr className="border-b-2 border-gray-800 text-gray-800 uppercase tracking-wider text-xs">
                     <th className="text-left py-2 font-bold">Item Description</th>
                     <th className="text-center py-2 font-bold w-16">Qty</th>
                     <th className="text-right py-2 font-bold w-24">Amount</th>
                   </tr>
                 </thead>
                 <tbody>
                   {order.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-dashed border-gray-200">
                        <td className="py-4 pr-4 font-medium text-gray-800">{item.name}</td>
                        <td className="py-4 text-center text-gray-600">{item.quantity}</td>
                        <td className="py-4 text-right font-medium text-gray-800">${(item.price * item.quantity).toFixed(2)}</td>
                      </tr>
                   ))}
                 </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-end text-sm">
                 <div className="w-64 space-y-3">
                   <div className="flex justify-between text-gray-600">
                     <span>Subtotal</span>
                     <span>${order.total.toFixed(2)}</span>
                   </div>
                   <div className="flex justify-between text-gray-600">
                     <span>Tax & Delivery</span>
                     <span>Included</span>
                   </div>
                   <div className="flex justify-between font-black text-lg pt-3 border-t-2 border-gray-800">
                     <span>Total USD</span>
                     <span>${order.total.toFixed(2)}</span>
                   </div>
                 </div>
              </div>

              {/* Footer */}
              <div className="mt-16 text-center text-xs text-gray-500 space-y-1">
                 <p className="font-bold text-gray-800">Thank you for your business!</p>
                 <p>If you have any questions, contact us at wgnganga@gmail.com</p>
                 <div className="pt-6 flex justify-center opacity-50 grayscale">
                    <Logo />
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const StatusBadge = ({ status }) => {
  const styles = {
    PUBLISHED: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    DRAFT: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
    ARCHIVED: 'bg-gray-800 text-gray-500 border border-gray-700',
    OUT_OF_STOCK: 'bg-red-500/10 text-red-400 border border-red-500/20',
    PENDING: 'wen-warning-badge',
    PROCESSING: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    SHIPPED: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    DELIVERED: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    CANCELLED: 'bg-red-500/10 text-red-400 border border-red-500/20',
  };

  const style = styles[status] || styles.DRAFT;
  const label = String(status || '').replace(/_/g, ' ');

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${style}`}>
      {label}
    </span>
  );
};
