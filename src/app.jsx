import React, { useState, useEffect, useContext, useMemo, useReducer, useRef } from 'react';
import toast from 'react-hot-toast';
import { 
  ShoppingCart, Search, Menu, X, User, ChevronRight, 
  Package, LayoutDashboard, Settings, LogOut, 
  TrendingUp, Users, DollarSign, Edit, Trash2, Plus,
  ShieldCheck, AlertTriangle, CheckCircle2, Lock,
  Printer, Download, ImagePlus, Moon, Sun, GripVertical, Star, MessagesSquare
} from 'lucide-react';
import { supabase } from './supabaseClient';
import SecureAdminLogin from './AdminLogin';
import SecureProductEditor from './ProductEditor';
import LiveApplianceCatalog from './ApplianceCatalog';
import Checkout from './Checkout';
import OrderTracking from './OrderTracking';
import SupabaseAdminOrders from './AdminOrders';
import SupabaseAdminMembers from './AdminMembers';
import AdminTools from './AdminTools';
import AdminProductChat from './AdminProductChat';
import AccountMenu from './AccountMenu';
import ResetPassword from './ResetPassword';
import ProductChatWidget from './ProductChatWidget';
import { ChatNotificationBell, ChatNotificationProvider } from './ChatNotifications';
import PresenceTracker from './PresenceTracker';
import OrderNotificationPrompt from './OrderNotificationPrompt';
import { AdminOrderNotificationWatcher, CustomerOrderNotificationWatcher } from './OrderNotificationWatchers';
import { rememberOrderForNotifications } from './browserNotifications';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from './businessInfo';
import {
  ADMIN_PORTAL_ROLE_MESSAGE,
  CUSTOMER_PORTAL_ADMIN_MESSAGE,
  isSuperAdminUser
} from './authSecurity';

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

const formatMoney = (amount) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const parseImageList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
  } catch {
    return [value];
  }
};

const normalizeProduct = (product) => {
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

const getProductImages = (product) => {
  const normalized = normalizeProduct(product);
  return [...new Set([normalized.image, ...normalized.gallery].filter(Boolean))];
};

const getWenAppliancesStoragePath = (value) => {
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

  const loadProducts = async () => {
    setProductsLoading(true);
    setProductsError('');

    const { data, error } = await supabase
      .from('products')
      .select('*');

    if (error) {
      setProducts([]);
      setProductsError(error.message);
    } else {
      setProducts((data ?? []).map(normalizeProduct));
    }

    setProductsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchProducts() {
      setProductsLoading(true);
      setProductsError('');

      const { data, error } = await supabase
        .from('products')
        .select('*');

      if (cancelled) return;

      if (error) {
        setProducts([]);
        setProductsError(error.message);
      } else {
        setProducts((data ?? []).map(normalizeProduct));
      }

      setProductsLoading(false);
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, []);

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
    window.scrollTo(0, 0);
  };

  // Cart Logic
  const addToCart = (productId, quantity = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock < quantity) {
        alert("Not enough stock available."); // Fallback if UI check fails
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

  // Order Logic
  const placeOrder = async (customerDetails) => {
    if (cart.length === 0) return false;

    const orderId = `ORD-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    
    const newOrder = {
      id: orderId,
      userId: user ? user.id : 'guest',
      customerName: customerDetails.name,
      total: cartTotal,
      status: 'PENDING',
      date: new Date().toISOString(),
      items: [...cart]
    };

    for (const cartItem of cart) {
      const product = products.find(p => p.id === cartItem.productId);
      if (!product || product.stock < cartItem.quantity) return false;
    }

    // Checkout still needs a server-side order/payment transaction before it
    // can safely change shared inventory. Keep this local until that backend
    // workflow is added instead of allowing anonymous database writes.
    setProducts(prevProducts => prevProducts.map(product => {
      const cartItem = cart.find(c => c.productId === product.id);
      if (!cartItem) return product;

      const newStock = product.stock - cartItem.quantity;
      return { ...product, stock: newStock, status: newStock <= 0 ? 'OUT_OF_STOCK' : product.status };
    }));

    setOrders(prev => [newOrder, ...prev]);
    setCart([]);
    return orderId;
  };

  const saveProduct = async (product) => {
    const { isNew, id, created_at, updated_at, ...formProduct } = product;
    const images = parseImageList(formProduct.gallery || formProduct.images || formProduct.image);
    const payload = {
      name: formProduct.name,
      category: formProduct.category,
      price: Number(formProduct.price),
      stock: Number(formProduct.stock),
      description: formProduct.description || '',
      images
    };

    const query = isNew
      ? supabase.from('products').insert(payload).select().single()
      : supabase.from('products').update(payload).eq('id', id).select().single();
    const { data, error } = await query;

    if (error) throw error;

    const savedProduct = normalizeProduct(data);
    setProducts(prev => isNew
      ? [savedProduct, ...prev]
      : prev.map(item => item.id === savedProduct.id ? savedProduct : item)
    );
    return savedProduct;
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
    await supabase.auth.signOut();
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
    products, setProducts, saveProduct, deleteProduct, loadProducts, productsLoading, productsError,
    orders, setOrders,
    cart, addToCart, updateCartQty, clearCart, cartTotal, cartItemCount, isCartOpen, setIsCartOpen,
    placeOrder,
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
        return <SecureAdminLogin theme={theme} toggleTheme={toggleTheme} onAuthenticated={() => navigate('/dashboard')} onClose={() => navigate('/')} />;
      }
      return <AdminLayout><AdminRouteErrorBoundary key={currentRoute}><AdminRouter route={currentRoute} /></AdminRouteErrorBoundary></AdminLayout>;
    }

    // Legacy admin URLs on the storefront are intentionally not exposed.
    if (currentRoute.startsWith('/hq-operations')) return <StoreLayout><StoreHome /></StoreLayout>;

    // Storefront Routes
    return (
      <StoreLayout>
        {currentRoute === '/' && <StoreHome />}
        {currentRoute === '/products' && <LiveApplianceCatalog onProductClick={(productId) => navigate(`/product/${productId}`)} />}
        {currentRoute.startsWith('/product/') && <StoreProductDetail id={currentRoute.split('/')[2]} />}
        {currentRoute === '/checkout' && <Checkout cart={cart} cartTotal={cartTotal} clearCart={clearCart} navigate={navigate} onOrderPlaced={({ orderId, email }) => {
          rememberOrderForNotifications(orderId, email);
          setTrackingPrefill({ orderId, email });
        }} />}
        {currentRoute === '/reset-password' && <ResetPassword navigate={navigate} />}
        {currentRoute === '/my-orders' && <OrderTracking initialValues={{ email: user?.email || '' }} accountMode />}
        {currentRoute.startsWith('/track-order') && <OrderTracking initialValues={{ email: trackingPrefill?.email || user?.email || '' }} />}
      </StoreLayout>
    );
  };

  return (
    <ChatNotificationProvider isAdmin={isAdminApp} active={!isAdminApp || user?.role === 'SUPER_ADMIN'}>
      <AppContext.Provider value={contextValue}>
        <div className="min-h-screen font-sans bg-[#F4F3EF] text-[#111214] antialiased">
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

  const handleNewsletterSubmit = (event) => {
    event.preventDefault();
    if (!newsletterEmail.trim()) return;
    setNewsletterMessage('Thanks! Newsletter updates are coming soon 😔');
    setNewsletterEmail('');
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
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-40 bg-[#F4F3EF]/90 backdrop-blur-md border-b border-[#E5E4E0]">
        <div className="mx-auto flex h-16 min-w-0 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <div onClick={() => handleNav('/', true)} className="cursor-pointer">
              <Logo />
            </div>
            <nav className="hidden md:flex gap-6 text-sm font-medium text-[#4A5568]">
              <button onClick={() => handleNav('/', true)} className="hover:text-[#111214] transition-colors">Home</button>
              <button onClick={() => handleNav('/products', true)} className="hover:text-[#111214] transition-colors">All Products</button>
              <button onClick={() => navigate('/track-order')} className="hover:text-[#111214] transition-colors">Track Order</button>
              <button onClick={() => setIsContactOpen(true)} className="hover:text-[#111214] transition-colors">Support</button>
            </nav>
          </div>
          
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="relative hidden md:block">
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
                className="pl-10 pr-4 py-2 bg-white border border-[#E5E4E0] rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[#9C6644]/50 w-64 transition-all"
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
            </div>
            
            <div className="hidden md:block"><ChatNotificationBell /></div>
            <div className="hidden md:block"><AccountMenu user={user} onTrackOrder={() => navigate('/track-order')} onMyOrders={() => navigate('/my-orders')} /></div>

            <div className="hidden md:block"><ThemeToggle theme={theme} toggleTheme={toggleTheme} /></div>
            
            <button 
              onClick={() => setIsCartOpen(true)}
              className="relative rounded-full p-2 transition-colors hover:bg-[#E5E4E0]"
              aria-label="Open shopping cart"
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
              className="inline-flex items-center justify-center rounded-full border border-[#E5E4E0] bg-white p-2 text-[#4A5568] transition hover:border-[#9C6644] hover:text-[#9C6644] md:hidden"
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
            <div id="storefront-mobile-menu" className="fixed inset-x-3 top-[4.5rem] z-[50] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-[#E5E4E0] bg-[#F4F3EF] p-3 text-left shadow-2xl md:hidden">
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
                  className="w-full rounded-xl border border-[#E5E4E0] bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20"
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
          <div className="bg-[#111214] text-white px-4 py-3 text-center text-sm">
            Loading the live appliance catalog...
          </div>
        )}
        {productsError && (
          <div className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-3 text-center text-sm">
            <span>We could not load products from Supabase: {productsError}</span>
            <button onClick={loadProducts} className="ml-3 font-semibold underline">Try again</button>
          </div>
        )}
        {children}
      </main>
      
      <footer className="bg-[#111214] text-[#F1F1EF] py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="mb-4 block text-left" aria-label="WenAppliances">
              <Logo dark={true} />
            </div>
            <p className="text-[#B8BAB7] text-sm leading-relaxed">Premium electronics and appliances for the modern lifestyle. Quality assured.</p>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-[#F1F1EF]">Shop</h3>
            <ul className="space-y-2 text-sm text-[#B8BAB7]">
              <li><button onClick={() => navigate('/products')} className="hover:text-white transition-colors">All Products</button></li>
              <li><button onClick={() => navigate('/products')} className="hover:text-white transition-colors">Shop by Category</button></li>
              <li><button onClick={() => navigate('/products')} className="hover:text-white transition-colors">Compare Appliances</button></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-[#F1F1EF]">Support</h3>
            <ul className="space-y-2 text-sm text-[#B8BAB7]">
              <li><button onClick={() => setIsContactOpen(true)} className="hover:text-white transition-colors">Contact Us</button></li>
              <li><button onClick={() => navigate('/track-order')} className="hover:text-white transition-colors">Track Order</button></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-[#F1F1EF]">Newsletter</h3>
            <p className="text-[#B8BAB7] text-sm mb-4">Subscribe for updates on new arrivals and offers.</p>
            <form onSubmit={handleNewsletterSubmit} className="flex">
              <label htmlFor="newsletter-email" className="sr-only">Email address</label>
              <input id="newsletter-email" type="email" required value={newsletterEmail} onChange={(event) => { setNewsletterEmail(event.target.value); setNewsletterMessage(''); }} placeholder="Email address" className="min-w-0 bg-[#1D2023] border border-[#24272A] px-3 py-2 rounded-l-md text-sm w-full focus:outline-none focus:border-[#9C6644]" />
              <button type="submit" className="shrink-0 bg-[#9C6644] hover:bg-[#8A5A3C] text-white px-4 py-2 rounded-r-md text-sm font-medium transition-colors">Subscribe</button>
            </form>
            {newsletterMessage && <p className="mt-2 text-xs font-medium text-[#D8B49A]" role="status" aria-live="polite">{newsletterMessage}</p>}
          </div>
        </div>
        
        {/* Watermark Section */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-8 border-t border-[#24272A] flex flex-col md:flex-row items-center justify-between text-sm text-[#858884]">
          <p>&copy; 2026 WenAppliances. All rights reserved.</p>
          <p className="mt-4 md:mt-0 font-medium tracking-wide text-[#9C6644] flex items-center gap-2">
            @gikunju creates
          </p>
        </div>
      </footer>

      {/* Contact Modal */}
      {isContactOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsContactOpen(false)}>
          <div className="bg-white rounded-xl p-6 md:p-8 max-w-md w-full relative shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => {setIsContactOpen(false); setContactSent(false);}} className="absolute top-4 right-4 text-[#858884] hover:text-[#111214]"><X className="h-5 w-5" /></button>
            
            {contactSent ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2 text-[#111214]">Message Sent</h3>
                  <p className="text-[#4A5568]">Your message has been successfully sent to {SUPPORT_EMAIL}. We'll get back to you shortly.</p>
              </div>
            ) : (
              <>
                <h3 className="text-2xl font-bold mb-6 text-[#111214]">Contact Support</h3>
                
                <div className="mb-6 p-4 bg-[#F4F3EF] rounded-lg border border-[#E5E4E0] text-sm text-[#4A5568] space-y-2 text-left">
                  <p className="font-medium text-[#111214]">Direct Contact Information:</p>
                  <p>Email: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#9C6644] hover:underline">{SUPPORT_EMAIL}</a></p>
                  <p>Phone: {SUPPORT_PHONE}</p>
                </div>

                <div className="space-y-4 text-left">
                  <div>
                    <label className="block text-sm font-medium text-[#4A5568] mb-1">Name</label>
                    <input type="text" className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 text-[#111214] focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4A5568] mb-1">Email</label>
                    <input type="email" className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 text-[#111214] focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4A5568] mb-1">Message</label>
                    <textarea rows={4} className="w-full border border-[#E5E4E0] rounded-lg px-4 py-2 text-[#111214] focus:ring-2 focus:ring-[#9C6644]/50 focus:border-[#9C6644] outline-none resize-none"></textarea>
                  </div>
                  <button onClick={() => setContactSent(true)} className="w-full bg-[#111214] text-white py-3 rounded-lg font-medium hover:bg-[#24272A] transition-colors mt-4">Send to {SUPPORT_EMAIL}</button>
                </div>
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
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity" onClick={() => setIsCartOpen(false)} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
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
  const { products, navigate, productsLoading } = useContext(AppContext);
  const featured = products.filter(p => p.status === 'PUBLISHED').slice(0, 4);

  return (
    <div>
      {/* Hero Section */}
      <section className="motion-fade-in relative bg-[#111214] text-white overflow-hidden">
        <div className="absolute inset-0 z-0 overflow-hidden">
           <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#9C6644]/30 blur-3xl"></div>
           <div className="absolute -bottom-40 right-1/3 h-96 w-96 rounded-full bg-[#F4F3EF]/10 blur-3xl"></div>
           <div className="absolute inset-0 bg-linear-to-r from-[#111214] via-[#111214]/95 to-[#9C6644]/20"></div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 relative z-10">
          <div className="max-w-xl">
            <span className="text-[#9C6644] font-bold tracking-wider text-sm uppercase mb-4 block">Premium Home Appliances</span>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 leading-tight">Elevate Your Living Space.</h2>
            <p className="text-lg text-[#B8BAB7] mb-8 leading-relaxed">Discover our curated selection of high-performance refrigerators, washers, and dryers. Engineered for reliability, designed for elegance.</p>
            <button 
              onClick={() => navigate('/products')}
              className="bg-[#9C6644] hover:bg-[#8A5A3C] text-white px-8 py-3 rounded-lg font-medium transition-colors shadow-lg"
            >
              Shop the Collection
            </button>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="motion-fade-up max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h3 className="text-2xl font-bold tracking-tight">Featured Products</h3>
            <p className="text-[#4A5568] mt-1 text-sm">Handpicked premium tech.</p>
          </div>
          <button onClick={() => navigate('/products')} className="text-[#9C6644] font-medium text-sm flex items-center hover:underline">
            View All <ChevronRight className="h-4 w-4 ml-1" />
          </button>
        </div>
        
        <div className="motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {productsLoading ? (
            <div className="col-span-full py-16 text-center text-[#858884]">Loading products...</div>
          ) : featured.length === 0 ? (
            <div className="col-span-full py-16 text-center text-[#858884]">Your live catalog is ready for products.</div>
          ) : featured.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
};

const ProductCard = ({ product }) => {
  const { navigate, addToCart } = useContext(AppContext);
  const isOutOfStock = product.stock <= 0;
  const primaryImage = getProductImages(product)[0];

  return (
    <div className="motion-card bg-white rounded-xl shadow-sm border border-[#E5E4E0] overflow-hidden group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full">
      <div 
        className="product-photo-surface relative aspect-square cursor-pointer overflow-hidden bg-[#F4F3EF]"
        onClick={() => navigate(`/product/${product.id}`)}
      >
        {primaryImage ? (
          <img
            src={primaryImage}
            alt={product.name}
            className="product-photo h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <ProductPlaceholder className="w-full h-full" />
        )}
        {isOutOfStock && (
          <div className="absolute top-2 right-2 bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded">
            Out of Stock
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col grow">
        <p className="text-xs text-[#858884] font-medium mb-1 uppercase tracking-wider">{product.category}</p>
        <h4 
          onClick={() => navigate(`/product/${product.id}`)}
          className="font-semibold text-[#111214] mb-2 line-clamp-2 cursor-pointer hover:text-[#9C6644] transition-colors"
        >
          {product.name}
        </h4>
        <div className="mt-auto flex items-center justify-between">
          <span className="font-bold text-lg text-[#111214]">{formatMoney(product.price)}</span>
          <button 
            onClick={() => addToCart(product.id)}
            disabled={isOutOfStock}
            className={`p-2 rounded-full transition-colors ${isOutOfStock ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#F4F3EF] text-[#111214] hover:bg-[#9C6644] hover:text-white'}`}
            title="Add to Cart"
          >
            <ShoppingCart className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
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
        <p className="text-[#4A5568] mt-2">Browse our complete catalog of premium electronics.</p>
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
  const { products, addToCart } = useContext(AppContext);
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

  if (!product) return <div className="p-20 text-center">Product not found.</div>;
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
    <div className="motion-fade-in max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      
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

      <div className="bg-white rounded-2xl shadow-sm border border-[#E5E4E0] overflow-hidden flex flex-col md:flex-row">
        {/* Image Gallery area */}
        <div className="product-photo-surface w-full md:w-1/2 bg-[#F4F3EF] p-8 flex flex-col items-center relative">
          
          {/* Main Image */}
          <div 
            className="relative w-full aspect-square flex items-center justify-center cursor-zoom-in group"
            onClick={() => images.length > 0 && openFullscreen()}
          >
            {images.length > 0 ? (
              <img
                key={imgIndex}
                src={images[imgIndex]}
                alt={product.name}
                className="product-photo max-w-full max-h-full object-contain drop-shadow-xl animate-in fade-in duration-500"
              />
            ) : (
              <ProductPlaceholder className="w-full h-full rounded-xl" />
            )}
            
            {images.length > 1 && (
              <>
                <button 
                  onClick={prevImg}
                  className="absolute left-2 bg-white/80 backdrop-blur hover:bg-white p-2 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-all duration-300"
                >
                  <ChevronRight className="h-5 w-5 rotate-180 text-black" />
                </button>
                <button 
                  onClick={nextImg}
                  className="absolute right-2 bg-white/80 backdrop-blur hover:bg-white p-2 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-all duration-300"
                >
                  <ChevronRight className="h-5 w-5 text-black" />
                </button>
              </>
            )}
          </div>

          {/* Thumbnails */}
          {images.length > 1 && (
            <div className="flex gap-4 mt-6 overflow-x-auto pb-2 w-full justify-center">
              {images.map((img, idx) => (
                <button 
                  key={idx}
                  onClick={() => setImgIndex(idx)}
                  className={`w-16 h-16 rounded-md bg-white border-2 overflow-hidden transition-all shrink-0 ${imgIndex === idx ? 'border-[#9C6644] opacity-100 scale-110 shadow-sm' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={img} alt={`Thumb ${idx}`} className="product-photo h-full w-full object-cover" />
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
        <div className="w-full md:w-1/2 p-8 lg:p-12 flex flex-col">
          <p className="text-sm text-[#858884] font-semibold uppercase tracking-wider mb-2">{product.category} • SKU: {product.sku}</p>
          <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-[#111214] mb-4">{product.name}</h1>
          <p className="text-2xl font-bold text-[#9C6644] mb-6">{formatMoney(product.price)}</p>
          
          <p className="text-[#4A5568] text-base leading-relaxed mb-8 border-b border-[#E5E4E0] pb-8">
            {product.description}
          </p>
          
          <div className="mt-auto space-y-6">
            <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-initial">
                <div className="min-w-[4.75rem] shrink-0">
                  <span className="block text-sm font-semibold text-[#4A5568]">Quantity</span>
                  <span className="mt-1 block text-xs text-[#858884]">{product.stock} available</span>
                </div>
                <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-[#E5E4E0] bg-white">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-2 text-[#4A5568] hover:bg-[#F4F3EF] transition-colors">-</button>
                <span className="px-4 py-2 font-medium w-12 text-center border-x border-[#E5E4E0]">{qty}</span>
                <button 
                  onClick={() => setQty(Math.min(product.stock, qty + 1))} 
                  disabled={qty >= product.stock}
                  className="px-4 py-2 text-[#4A5568] hover:bg-[#F4F3EF] transition-colors disabled:opacity-50"
                >
                  +
                </button>
                </div>
              </div>
              <ProductChatWidget productId={product.id} productName={product.name} inlineTrigger />
            </div>
            
            <button 
              onClick={() => addToCart(product.id, qty)}
              disabled={isOutOfStock}
              className={`add-to-cart-button w-full py-4 rounded-xl font-bold text-lg transition-all shadow-md ${
                isOutOfStock 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none' 
                  : 'bg-[#111214] text-white hover:bg-[#24272A] hover:shadow-lg active:scale-[0.98]'
              }`}
            >
              {isOutOfStock ? 'Currently Unavailable' : 'Add to Cart'}
            </button>
            
            <div className="grid grid-cols-1 gap-3 text-sm text-[#4A5568] pt-4 border-t border-[#E5E4E0] sm:grid-cols-2">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-[#9C6644]"/> 3 Months Warranty</div>
              <div className="flex items-center gap-2"><Package className="h-4 w-4 shrink-0 text-[#9C6644]"/> Delivery is offered</div>
              <div className="flex items-center gap-2 sm:col-span-2"><Trash2 className="h-4 w-4 shrink-0 text-[#9C6644]"/> Old appliance haul-away offered</div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
        alert("Error processing order. Check stock and your Supabase permissions.");
      }
    } catch (error) {
      alert(error.message || "Error processing order.");
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

const AdminLayout = ({ children }) => {
  const { user, logout, navigate, currentRoute, theme, toggleTheme, adminBasePath } = useContext(AppContext);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const storefrontUrl = import.meta.env.VITE_STOREFRONT_URL || (isAdminApp ? 'https://wenappliances.vercel.app' : '/');

  useEffect(() => {
    let active = true;

    const refreshActiveOrderCount = async () => {
      const { data, error } = await supabase.from('orders').select('id, status');
      if (!active || error) return;

      const count = (data ?? []).filter((order) => {
        const status = String(order.status || '').toLowerCase();
        return !status.includes('cancel') && !status.includes('complete') && !status.includes('deliver') && !status.includes('picked');
      }).length;
      setActiveOrderCount(count);
    };

    refreshActiveOrderCount();
    const refreshTimer = window.setInterval(refreshActiveOrderCount, 10000);
    const ordersChannel = supabase
      .channel(`admin-order-indicator-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refreshActiveOrderCount)
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [currentRoute]);
  
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'products', label: 'Inventory & Products', icon: Package },
    { id: 'orders', label: 'Order Management', icon: ShoppingCart },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'chats', label: 'Product Chats', icon: MessagesSquare },
    { id: 'tools', label: 'Admin Tools', icon: Settings },
  ];

  return (
    <div className="motion-fade-in min-h-screen bg-[#0B0B0C] text-[#F1F1EF] flex font-sans selection:bg-[#9C6644]/30">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[#24272A] bg-[#17191C] md:flex">
        <div className="p-6 border-b border-[#24272A]">
          <Logo dark={theme === 'dark'} />
        </div>
        <nav className="grow py-6 px-3 space-y-1">
          {navItems.map(item => {
            const path = `${adminBasePath}/${item.id}` || `/${item.id}`;
            const adminRoot = adminBasePath ? currentRoute === adminBasePath : currentRoute === '/';
            const active = currentRoute.includes(item.id) || (adminRoot && item.id === 'dashboard');
            return (
              <button 
                key={item.id}
                onClick={() => navigate(path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-[#9C6644] text-white' : 'text-[#B8BAB7] hover:bg-[#24272A] hover:text-[#F1F1EF]'
                }`}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                  <span className="truncate">{item.label}</span>
                  {item.id === 'orders' && activeOrderCount > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#9C6644] px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${activeOrderCount} active orders`}>
                      {activeOrderCount}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#24272A] flex flex-col gap-4">
           <div className="flex items-center gap-3 px-2">
             <div className="h-8 w-8 rounded-full bg-[#24272A] flex items-center justify-center text-[#9C6644] font-bold text-xs">{user.name.charAt(0)}</div>
             <div className="flex flex-col">
               <span className="text-sm font-medium text-[#F1F3EF]">{user.name}</span>
               <span className="text-[10px] text-[#858884] uppercase tracking-wider">{user.role}</span>
             </div>
           </div>
           <button onClick={logout} className="flex items-center gap-2 text-sm text-[#858884] hover:text-red-400 px-2 py-1 transition-colors">
              <LogOut className="h-4 w-4" /> Terminate Session
           </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex min-w-0 grow flex-col overflow-hidden md:h-screen">
        <header className="relative z-[110] flex min-h-16 shrink-0 items-center justify-between border-b border-[#24272A] bg-[#17191C]/80 px-4 backdrop-blur-md sm:px-8">
           <div className="flex min-w-0 items-center gap-2 text-sm text-[#858884]">
             <button type="button" onClick={() => setIsMobileNavOpen((open) => !open)} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[#4A5568]/40 bg-[#24272A] p-2 text-[#F1F1EF] hover:bg-[#30343A] md:hidden" aria-label={isMobileNavOpen ? 'Close administrator navigation' : 'Open administrator navigation'} aria-expanded={isMobileNavOpen}>
               {isMobileNavOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
             </button>
             <Lock className="hidden h-4 w-4 shrink-0 sm:block" />
             <span className="hidden truncate sm:inline">Environment: Production Database</span>
             <span className="sm:hidden">Admin</span>
           </div>
             <div className="flex items-center gap-3">
             <ChatNotificationBell />
             <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
             <a href={storefrontUrl} className="text-xs bg-[#24272A] hover:bg-[#1D2023] px-3 py-1.5 rounded border border-[#4A5568]/30 transition-colors">
               <span className="hidden sm:inline">View Public Storefront</span>
               <span className="sm:hidden">Store</span>
             </a>
           </div>
           {isMobileNavOpen && (
             <>
               <button type="button" onClick={() => setIsMobileNavOpen(false)} className="fixed inset-x-0 bottom-0 top-16 z-[90] bg-black/50 md:hidden" aria-label="Close administrator navigation" />
               <nav className="fixed inset-x-0 top-16 z-[100] max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-[#24272A] bg-[#17191C] p-3 shadow-2xl md:hidden" aria-label="Administrator navigation">
               <div className="grid gap-1">
                 {navItems.map((item) => {
                   const path = `${adminBasePath}/${item.id}` || `/${item.id}`;
                   const adminRoot = adminBasePath ? currentRoute === adminBasePath : currentRoute === '/';
                   const active = currentRoute.includes(item.id) || (adminRoot && item.id === 'dashboard');
                   return (
                     <button
                       key={item.id}
                       type="button"
                       onClick={() => navigate(path)}
                       className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors ${active ? 'bg-[#9C6644] text-white' : 'text-[#B8BAB7] hover:bg-[#24272A] hover:text-[#F1F1EF]'}`}
                     >
                       <item.icon className="h-4 w-4 shrink-0" />
                       <span className="min-w-0 flex-1 truncate">{item.label}</span>
                       {item.id === 'orders' && activeOrderCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#9C6644] px-1.5 py-0.5 text-[10px] font-bold text-white">{activeOrderCount}</span>}
                     </button>
                   );
                 })}
               </div>
               </nav>
             </>
           )}
        </header>
        <div className="min-w-0 grow overflow-y-auto p-4 sm:p-8">
           <div className="max-w-6xl mx-auto">
             {children}
           </div>
        </div>
      </main>
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

const normalizeAdminOrderStatus = (status) => {
  const value = String(status || 'Pending').trim().toLowerCase();
  if (value.includes('cancel')) return 'CANCELLED';
  if (value.includes('complete') || value.includes('deliver') || value.includes('picked')) return 'COMPLETED';
  if (value.includes('confirm') || value.includes('process')) return 'CONFIRMED';
  return 'PENDING';
};

const AdminDashboard = () => {
  const { navigate, adminBasePath } = useContext(AppContext);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      const [ordersResult, productsResult] = await Promise.all([
        supabase.from('orders').select('id, customer_name, total_amount, status, created_at').order('created_at', { ascending: false }),
        // Keep this query compatible with the production products schema;
        // SKU is not a column in the current table.
        supabase.from('products').select('id, name, stock, price').order('name')
      ]);

      if (!active) return;

      if (ordersResult.error || productsResult.error) {
        setError(ordersResult.error?.message || productsResult.error?.message || 'Unable to load dashboard data.');
      } else {
        setError('');
      }

      setOrders(ordersResult.data ?? []);
      setProducts(productsResult.data ?? []);
      setLastUpdated(new Date());
      setLoading(false);
    };

    loadDashboard();
    const refreshTimer = window.setInterval(loadDashboard, 30000);
    const dashboardChannel = supabase
      .channel(`admin-dashboard-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, loadDashboard)
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(dashboardChannel);
    };
  }, []);

  const trackedOrders = orders.filter((order) => normalizeAdminOrderStatus(order.status) !== 'CANCELLED');
  const activeOrders = trackedOrders.filter((order) => {
    const status = normalizeAdminOrderStatus(order.status);
    return status === 'PENDING' || status === 'CONFIRMED';
  });
  const completedOrders = trackedOrders.filter((order) => normalizeAdminOrderStatus(order.status) === 'COMPLETED');
  const pendingOrders = activeOrders.filter((order) => normalizeAdminOrderStatus(order.status) === 'PENDING');
  const collectedRevenue = completedOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const pendingValue = pendingOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const lowStockProducts = products.filter((product) => Number(product.stock || 0) <= 10);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
          <p className="mt-1 text-sm text-[#858884]">Live operational figures from your Supabase database.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-[#858884]">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button type="button" onClick={() => navigate(`${adminBasePath}/tools` || '/tools')} className="inline-flex items-center gap-2 rounded-lg bg-[#9C6644] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#8A5A3C]"><Settings className="h-4 w-4" /> Admin tools</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      <div className="motion-stagger grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Collected Revenue" value={formatMoney(collectedRevenue)} icon={DollarSign} />
        <StatCard title="Pending Order Value" value={formatMoney(pendingValue)} icon={TrendingUp} color="text-emerald-400" />
        <StatCard title="Active Orders" value={activeOrders.length} icon={ShoppingCart} />
        <StatCard title="Attention Needed" value={`${pendingOrders.length} Pending | ${lowStockProducts.length} Low Stock`} icon={AlertTriangle} color="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="col-span-2 overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#24272A] p-5"><div><h3 className="font-semibold text-[#F1F3EF]">Recent Transactions</h3><p className="mt-1 text-xs text-[#858884]">Completed, confirmed, and pending orders.</p></div><button type="button" onClick={() => navigate(`${adminBasePath}/orders` || '/orders')} className="text-xs font-semibold text-[#9C6644] hover:underline">Open orders</button></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-[#0B0B0C] text-xs uppercase tracking-wider text-[#858884]"><tr><th className="px-5 py-3 font-medium">Order ID</th><th className="px-5 py-3 font-medium">Customer</th><th className="px-5 py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-[#24272A]">
                {orders.slice(0, 5).map((order) => <tr key={order.id} className="transition-colors hover:bg-[#1D2023]"><td className="px-5 py-4 font-mono text-xs text-[#B8BAB7]">{order.id}</td><td className="px-5 py-4 text-[#F1F1EF]">{order.customer_name || 'Unnamed customer'}</td><td className="px-5 py-4 font-medium text-[#F1F1EF]">{formatMoney(order.total_amount)}</td><td className="px-5 py-4"><StatusBadge status={normalizeAdminOrderStatus(order.status)} /></td></tr>)}
                {!loading && !orders.length && <tr><td colSpan="4" className="p-8 text-center text-sm text-[#858884]">No orders found in the database.</td></tr>}
                {loading && <tr><td colSpan="4" className="p-8 text-center text-sm text-[#858884]">Loading live orders...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#24272A] p-5"><h3 className="flex items-center gap-2 font-semibold text-[#F1F3EF]"><AlertTriangle className="h-4 w-4 text-amber-500" /> Stock Alerts</h3><button type="button" onClick={() => navigate(`${adminBasePath}/tools` || '/tools')} className="text-xs font-semibold text-[#9C6644] hover:underline">View tools</button></div>
          <div className="space-y-4 p-5">
            {lowStockProducts.slice(0, 8).map((product) => <div key={product.id} className="flex items-start justify-between gap-3 border-b border-[#24272A] pb-4 last:border-0 last:pb-0"><div className="min-w-0"><p className="line-clamp-1 text-sm font-medium text-[#F1F3EF]">{product.name || 'Unnamed appliance'}</p><p className="mt-1 text-xs font-mono text-[#858884]">{product.sku || '—'}</p></div><div className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${Number(product.stock || 0) <= 0 ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>{Number(product.stock || 0)} left</div></div>)}
            {!loading && !lowStockProducts.length && <p className="py-4 text-center text-sm text-[#858884]">Inventory levels are healthy.</p>}
            {loading && <p className="py-4 text-center text-sm text-[#858884]">Loading inventory...</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, trend, color = "text-[#F1F1EF]" }) => (
  <div className="bg-[#17191C] p-6 rounded-xl border border-[#24272A] shadow-sm flex min-h-32 flex-col justify-between">
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

const AdminProducts = () => {
  const { products, saveProduct, deleteProduct, productsLoading, productsError, navigate, adminBasePath } = useContext(AppContext);
  const [editingProduct, setEditingProduct] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [deletingProductId, setDeletingProductId] = useState(null);

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
    const confirmed = window.confirm(
      `Delete “${product.name}” completely? This removes the product and its uploaded images and cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingProductId(product.id);
    try {
      const result = await deleteProduct(product);
      if (result?.storageWarning) {
        toast.error(`Product deleted, but one or more images could not be removed: ${result.storageWarning}`);
      } else {
        toast.success('Product and its images were deleted completely.');
      }
    } catch (error) {
      const message = error.message || 'Unable to delete this product.';
      if (/foreign key|referenced|violates/i.test(message)) {
        toast.error('This product is linked to an order and cannot be deleted from the catalog history.');
      } else {
        toast.error(message);
      }
    } finally {
      setDeletingProductId(null);
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
              ) : products.map(p => (
                <tr key={p.id} className="hover:bg-[#1D2023] transition-colors">
                  <td className="px-6 py-4">
                     {p.image ? <img src={p.image} alt="" className="w-10 h-10 object-cover rounded bg-white" /> : <ProductPlaceholder dark className="w-10 h-10 rounded" />}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-[#F1F1EF]">{p.name}</div>
                    <div className="text-xs font-mono text-[#858884] mt-1">{p.sku} • {p.category}</div>
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-[#F1F1EF]">
                    {p.price.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold ${p.stock <= 0 ? 'bg-red-500/20 text-red-400' : (p.stock < 10 ? 'bg-amber-500/20 text-amber-400' : 'bg-[#24272A] text-[#B8BAB7]')}`}>
                       {p.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => setEditingProduct(p)} className="text-[#858884] hover:text-[#9C6644] p-2 transition-colors" title={`Edit ${p.name}`} aria-label={`Edit ${p.name}`}>
                      <Edit className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(p)} disabled={deletingProductId === p.id} className="p-2 text-[#858884] transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`}>
                      {deletingProductId === p.id ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
                <input required type="text" list="category-options" name="category" value={formData.category} onChange={handleChange} placeholder="e.g. Washers" className="w-full bg-[#0B0B0C] border border-[#24272A] rounded-lg px-4 py-2.5 text-[#F1F1EF] focus:outline-none focus:border-[#9C6644] transition-all" />
                <datalist id="category-options">
                  <option value="Refrigerators" />
                  <option value="Washers" />
                  <option value="Dryers" />
                  <option value="Washer & Dryer" />
                  <option value="Ovens" />
                  <option value="Microwaves" />
                  <option value="TVs" />
                  <option value="Other" />
                </datalist>
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
    PENDING: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    PROCESSING: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    SHIPPED: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    DELIVERED: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    CANCELLED: 'bg-red-500/10 text-red-400 border border-red-500/20',
  };

  const style = styles[status] || styles.DRAFT;
  const label = status.replace(/_/g, ' ');

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${style}`}>
      {label}
    </span>
  );
};
