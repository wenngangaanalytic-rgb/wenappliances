import { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mail,
  MapPin,
  Package,
  Phone,
  Search,
  Save,
  Upload,
  UserRound,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import { downloadReceiptPdf, getReceiptItems, getReceiptStatusLabel } from './receiptPdf';
import { triggerLightHaptic, triggerSuccessHaptic } from './nativeAdmin';

const STATUS_OPTIONS = [
  { value: 'Pending', label: 'Pending' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'Completed', label: 'Delivered & Paid / Picked & Paid' },
  { value: 'Cancelled', label: 'Cancelled' }
];

const STATUS_STYLES = {
  Pending: 'order-status-pending',
  Confirmed: 'order-status-confirmed',
  Completed: 'order-status-completed',
  Cancelled: 'order-status-cancelled'
};

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0);

const getImages = (product) => {
  if (Array.isArray(product?.images)) return product.images.filter(Boolean);
  if (typeof product?.images === 'string' && product.images.trim()) {
    try {
      const parsed = JSON.parse(product.images);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [product.images];
    } catch {
      return [product.images];
    }
  }
  return [];
};

const getItemsSubtotal = (order) =>
  (order.order_items ?? []).reduce((sum, item) => sum + Number(item.price_at_time || 0) * Number(item.quantity || 0), 0);

const normalizeStatus = (status) => {
  const value = String(status || 'Pending').trim();
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'delivered' || lowerValue === 'delivered & paid' || lowerValue === 'picked' || lowerValue === 'picked & paid' || lowerValue === 'complete' || lowerValue === 'completed') return 'Completed';
  if (lowerValue === 'paid & confirmed' || lowerValue === 'confirmed' || lowerValue === 'processing') return 'Confirmed';
  return STATUS_OPTIONS.some((option) => option.value === value) ? value : 'Pending';
};

const getStatusOptions = (order) => STATUS_OPTIONS.map((option) => option.value === 'Completed'
  ? { ...option, label: order?.fulfillment_method === 'DOOR_PICKUP' ? 'Picked & Paid' : 'Delivered & Paid' }
  : option);

const statusLabel = (status, fulfillmentMethod) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'Completed') return fulfillmentMethod === 'DOOR_PICKUP' ? 'Picked & Paid' : 'Delivered & Paid';
  return STATUS_OPTIONS.find((option) => option.value === normalized)?.label || normalized;
};

const statusClass = (status) => STATUS_STYLES[normalizeStatus(status)] || 'order-status-unknown';
const ORDERS_PAGE_SIZE = 20;
const DELIVERY_DOCUMENT_BUCKET = 'wen-delivery-documents';
const DELIVERY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const isMissingColumn = (error, column) => (
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || String(error?.message || '').toLowerCase().includes(column.toLowerCase())
);

const getSafeSearchTerm = (value) => String(value || '').trim().replace(/[^\p{L}\p{N}@.+\-\s]/gu, ' ').replace(/\s+/g, ' ').slice(0, 100);

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const getDocumentExtension = (file) => {
  const knownExtensions = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  return knownExtensions[file.type] || '';
};

const buildReceiptEmailBody = (order) => {
  const items = getReceiptItems(order).map((item) => `${item.name} x ${item.quantity} - ${formatMoney(item.total)}`);
  return [
    'WenAppliances receipt',
    `Order: ${order.id}`,
    `Customer: ${order.customer_name || 'Not provided'}`,
    `Phone: ${order.customer_phone || 'Not provided'}`,
    `Status: ${getReceiptStatusLabel(order)}`,
    `Fulfillment: ${order.fulfillment_method === 'DOOR_PICKUP' ? 'Door pickup' : 'Delivery is offered'}`,
    '',
    'Items:',
    ...(items.length ? items : ['No line items found.']),
    '',
    `Total recorded: ${formatMoney(order.total_amount)}`,
    '',
    'Thank you for choosing WenAppliances.'
  ].join('\n');
};

const emailReceipt = (order) => {
  if (!order.customer_email) {
    toast.error('This order does not have a customer email address.');
    return;
  }

  const subject = `WenAppliances receipt - ${order.id}`;
  window.location.href = `mailto:${order.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildReceiptEmailBody(order))}`;
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [page, setPage] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [deliveryFieldsReady, setDeliveryFieldsReady] = useState(null);
  const [deliveryDrafts, setDeliveryDrafts] = useState({});
  const [savingDeliveryId, setSavingDeliveryId] = useState('');
  const [uploadingDocumentId, setUploadingDocumentId] = useState('');
  const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());
  const [updatingOrderId, setUpdatingOrderId] = useState('');
  const [editingPriceId, setEditingPriceId] = useState('');
  const [priceDraft, setPriceDraft] = useState('');
  const [savingPriceId, setSavingPriceId] = useState('');
  const [adjustedOrderIds, setAdjustedOrderIds] = useState(new Set());
  const pendingOrdersOnPage = orders.filter((order) => normalizeStatus(order.status) === 'Pending').length;
  const confirmedOrdersOnPage = orders.filter((order) => normalizeStatus(order.status) === 'Confirmed').length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    void supabase.from('orders')
      .select('delivery_assignee_name, delivery_assignee_phone, delivery_document_path')
      .limit(0)
      .then(({ error: schemaError }) => {
        if (!active) return;
        if (!schemaError) setDeliveryFieldsReady(true);
        else if (['42703', 'PGRST204'].includes(schemaError.code) || /delivery_assignee_name|delivery_document_path/i.test(schemaError.message || '')) {
          setDeliveryFieldsReady(false);
        } else {
          console.warn('Could not verify order delivery fields.', schemaError);
          setDeliveryFieldsReady(false);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onNavigate = (event) => {
      const path = String(event.detail?.path || '');
      if (!path.includes('/orders')) return;
      const nextSearch = new URL(path, window.location.origin).searchParams.get('search') || '';
      setSearch(nextSearch);
      setPage(0);
    };
    window.addEventListener('wen:navigate', onNavigate);
    return () => window.removeEventListener('wen:navigate', onNavigate);
  }, []);

  useEffect(() => {
    let active = true;

    const fetchOrders = async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      const safeSearch = getSafeSearchTerm(debouncedSearch);
      let query = supabase.from('orders').select(`
        *,
        order_items (
          id,
          product_name,
          product_images,
          quantity,
          price_at_time,
          products (
            name,
            images
          )
        )
      `, { count: 'exact' }).not('status', 'ilike', '%cancel%');

      if (safeSearch.length >= 2) {
        if (isUuid(safeSearch)) query = query.eq('id', safeSearch);
        else query = query.or(`customer_name.ilike.%${safeSearch}%,customer_email.ilike.%${safeSearch}%`);
      }

      const from = page * ORDERS_PAGE_SIZE;
      const [{ data, error: fetchError, count }, activeCountResult] = await Promise.all([
        query.order('created_at', { ascending: false }).range(from, from + ORDERS_PAGE_SIZE - 1),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['Pending', 'Confirmed', 'Processing', 'Paid & Confirmed'])
      ]);

      if (!active) return;

      if (fetchError) {
        console.error('Orders Fetch Error:', fetchError);
        if (!silent) {
          setOrders([]);
          setError(fetchError.message || 'Unable to load orders.');
          toast.error(fetchError.message || 'Unable to load orders.');
        }
      } else {
        setOrders((data ?? []).filter((order) => normalizeStatus(order.status) !== 'Cancelled'));
        setTotalOrders(count ?? 0);
        if (!activeCountResult.error) setActiveOrderCount(activeCountResult.count ?? 0);
        setDeliveryDrafts((current) => Object.fromEntries((data ?? []).map((order) => [order.id, {
          name: current[order.id]?.name ?? order.delivery_assignee_name ?? '',
          phone: current[order.id]?.phone ?? order.delivery_assignee_phone ?? ''
        }])));
      }

      if (!silent) setLoading(false);
    };

    fetchOrders();
    window.addEventListener('wen:admin-refresh', fetchOrders);

    const refreshTimer = window.setInterval(() => fetchOrders(true), 30000);
    const ordersChannel = supabase
      .channel(`admin-orders-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders(true))
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('wen:admin-refresh', fetchOrders);
      window.clearInterval(refreshTimer);
      supabase.removeChannel(ordersChannel);
    };
  }, [page, debouncedSearch]);

  const toggleOrder = (orderId) => {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const updateStatus = async (orderId, newStatus) => {
    const normalizedNewStatus = normalizeStatus(newStatus);
    const currentOrder = orders.find((order) => order.id === orderId);
    const currentStatus = normalizeStatus(currentOrder?.status);
    let cancellationReason = null;

    if (normalizedNewStatus === 'Cancelled') {
      if (currentStatus !== 'Pending') {
        cancellationReason = window.prompt('Enter the reason for cancelling this confirmed order:', '')?.trim() || '';
        if (!cancellationReason) {
          toast.error('A cancellation reason is required for a confirmed order.');
          return;
        }
      } else {
        cancellationReason = 'Cancelled by administrator before confirmation.';
      }
    }

    const previousOrders = orders;
    setUpdatingOrderId(orderId);
    void triggerLightHaptic();
    setOrders((current) => normalizedNewStatus === 'Cancelled'
      ? current.filter((order) => order.id !== orderId)
      : current.map((order) => order.id === orderId ? { ...order, status: normalizedNewStatus } : order));

    let updateError;
    if (normalizedNewStatus === 'Cancelled') {
      ({ error: updateError } = await supabase.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_cancellation_reason: cancellationReason
      }));
    } else {
      ({ error: updateError } = await supabase
        .from('orders')
        .update({ status: normalizedNewStatus })
        .eq('id', orderId));
    }

    if (updateError) {
      setOrders(previousOrders);
      console.error('Order Status Update Error:', updateError);
      toast.error(updateError.message || 'Failed to update order status.');
    } else {
      if (normalizedNewStatus === 'Cancelled') {
        setExpandedOrderIds((current) => {
          const next = new Set(current);
          next.delete(orderId);
          return next;
        });
        toast.success('Order cancelled, stock restored, and removed from the list.');
        void triggerSuccessHaptic();
      } else {
        toast.success(`Order updated: ${statusLabel(normalizedNewStatus, currentOrder?.fulfillment_method)}.`);
        void triggerSuccessHaptic();
      }
    }

    setUpdatingOrderId('');
  };

  const beginPriceEdit = (order) => {
    setEditingPriceId(order.id);
    setPriceDraft(String(Number(order.total_amount || 0).toFixed(2)));
  };

  const cancelPriceEdit = () => {
    setEditingPriceId('');
    setPriceDraft('');
  };

  const savePrice = async (orderId) => {
    const negotiatedPrice = Number.parseFloat(priceDraft);
    if (!Number.isFinite(negotiatedPrice) || negotiatedPrice < 0) {
      toast.error('Enter a valid non-negative price.');
      return;
    }

    const previousOrders = orders;
    setSavingPriceId(orderId);
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, total_amount: negotiatedPrice } : order));

    const { error: updateError } = await supabase
      .from('orders')
      .update({ total_amount: negotiatedPrice })
      .eq('id', orderId);

    if (updateError) {
      setOrders(previousOrders);
      console.error('Order Price Update Error:', updateError);
      toast.error(updateError.message || 'Failed to update the final paid amount.');
    } else {
      setAdjustedOrderIds((current) => new Set(current).add(orderId));
      toast.success('Final paid amount saved.');
      cancelPriceEdit();
    }

    setSavingPriceId('');
  };

  const saveDeliveryAssignment = async (order) => {
    const draft = deliveryDrafts[order.id] || {};
    const name = String(draft.name || '').trim();
    const phone = String(draft.phone || '').trim();
    if ((name && !phone) || (!name && phone)) {
      toast.error('Enter both the delivery contact name and phone, or clear both fields.');
      return;
    }
    if (name.length > 120 || (phone && (phone.length > 32 || !/^[+()\d\s.-]{7,32}$/.test(phone)))) {
      toast.error('Enter a valid delivery contact name and phone number.');
      return;
    }
    if (!deliveryFieldsReady) {
      toast.error('Apply the admin operations Supabase migration before saving delivery assignments.');
      return;
    }

    setSavingDeliveryId(order.id);
    const assignment = { delivery_assignee_name: name || null, delivery_assignee_phone: phone || null };
    const { error: updateError } = await supabase.from('orders').update(assignment).eq('id', order.id);
    if (updateError) {
      if (isMissingColumn(updateError, 'delivery_assignee_name')) setDeliveryFieldsReady(false);
      toast.error(updateError.message || 'Unable to save delivery assignment.');
    } else {
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...assignment } : item));
      toast.success(name ? 'Delivery contact saved.' : 'Delivery contact cleared.');
    }
    setSavingDeliveryId('');
  };

  const uploadDeliveryDocument = async (order, file) => {
    if (!file) return;
    const extension = getDocumentExtension(file);
    if (!extension) {
      toast.error('Choose a PDF, JPG, PNG, or WEBP delivery document.');
      return;
    }
    if (file.size > DELIVERY_DOCUMENT_MAX_BYTES) {
      toast.error('Delivery documents must be 10 MB or smaller.');
      return;
    }
    if (!deliveryFieldsReady) {
      toast.error('Apply the admin operations Supabase migration before uploading delivery documents.');
      return;
    }

    const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const documentPath = `${order.id}/${uniqueId}.${extension}`;
    setUploadingDocumentId(order.id);
    const { error: uploadError } = await supabase.storage.from(DELIVERY_DOCUMENT_BUCKET).upload(documentPath, file, {
      contentType: file.type,
      upsert: false
    });

    if (uploadError) {
      toast.error(uploadError.message || 'Unable to upload delivery document.');
      setUploadingDocumentId('');
      return;
    }

    const { error: updateError } = await supabase.from('orders')
      .update({ delivery_document_path: documentPath })
      .eq('id', order.id);
    if (updateError) {
      await supabase.storage.from(DELIVERY_DOCUMENT_BUCKET).remove([documentPath]);
      if (isMissingColumn(updateError, 'delivery_document_path')) setDeliveryFieldsReady(false);
      toast.error(updateError.message || 'Unable to attach delivery document to this order.');
    } else {
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, delivery_document_path: documentPath } : item));
      if (order.delivery_document_path) {
        const { error: cleanupError } = await supabase.storage.from(DELIVERY_DOCUMENT_BUCKET).remove([order.delivery_document_path]);
        if (cleanupError) toast.error('Document updated, but the previous private file could not be removed.');
      }
      toast.success('Private delivery document uploaded.');
    }
    setUploadingDocumentId('');
  };

  const openDeliveryDocument = async (path) => {
    if (!path || !deliveryFieldsReady) return;
    const { data, error: signedUrlError } = await supabase.storage.from(DELIVERY_DOCUMENT_BUCKET).createSignedUrl(path, 300);
    if (signedUrlError || !data?.signedUrl) {
      toast.error(signedUrlError?.message || 'Could not open this delivery document.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="space-y-6" aria-labelledby="admin-orders-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#9C6644]/30 bg-[#9C6644]/10 text-[#C08457]">
            <Package className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9C6644]">Operations / Orders</p>
            <h1 id="admin-orders-title" className="mt-1 text-2xl font-bold tracking-tight text-[#F1F3EF]">Order management</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#858884]">Review customer details, update fulfillment status, and record negotiated pricing.</p>
          </div>
        </div>
        {!loading && <span className="inline-flex items-center gap-2 rounded-full border border-[#9C6644]/30 bg-[#9C6644]/10 px-3 py-1.5 text-xs font-semibold text-[#C08457]"><span className="h-2 w-2 rounded-full bg-[#C08457]" aria-hidden="true" />{activeOrderCount} active order{activeOrderCount === 1 ? '' : 's'}</span>}
      </div>

      {deliveryFieldsReady === false && <div className="wen-warning-panel rounded-lg border p-4 text-sm" role="status">Delivery assignment and private document controls are waiting for the Supabase migration <code className="font-semibold">20261018000000_admin_dashboard_operations.sql</code>.</div>}

      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Order summary">
        {[
          { label: 'Matching orders', value: loading ? '—' : totalOrders, icon: Package },
          { label: 'Pending on this page', value: loading ? '—' : pendingOrdersOnPage, icon: Calendar },
          { label: 'Confirmed on this page', value: loading ? '—' : confirmedOrdersOnPage, icon: CheckCircle2 }
        ].map(({ label, value, icon: Icon }, index) => (
          <div key={label} className="flex min-w-0 items-center gap-3 rounded-xl border border-[#24272A] bg-[#17191C] px-4 py-3 shadow-sm transition-colors hover:border-[#9C6644]/40">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#9C6644]/10 text-[#C08457]">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-[#858884]">{label}</p>
              <p className={`mt-0.5 text-lg font-bold tabular-nums ${index === 1 && Number(value) > 0 ? 'wen-warning-foreground' : 'text-[#F1F3EF]'}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#24272A] bg-[#17191C] p-3 shadow-sm sm:p-4">
        <label className="relative block max-w-2xl">
          <span className="sr-only">Search orders by customer or order ID</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#858884]" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or order ID" className="min-h-11 w-full rounded-lg border border-[#3A3D40] bg-[#0B0B0C] py-2.5 pl-10 pr-3 text-sm text-[#F1F3EF] outline-none placeholder:text-[#777B78] transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
        </label>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      {loading ? (
        <div className="space-y-4" aria-label="Loading orders">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-[#24272A] bg-[#17191C]" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#4A5568] bg-[#17191C] px-6 py-14 text-center shadow-sm sm:px-12">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9C6644]/10 text-[#C08457]">
            <Package className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-[#F1F3EF]">{debouncedSearch.trim() ? 'No matching orders' : 'No orders yet'}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#858884]">{debouncedSearch.trim() ? 'Try another customer name, email, or complete order ID.' : 'Orders will appear here when customers complete checkout.'}</p>
          {debouncedSearch.trim() && <button type="button" onClick={() => setSearch('')} className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg border border-[#9C6644]/40 px-4 text-sm font-semibold text-[#C08457] transition hover:bg-[#9C6644]/10">Clear search</button>}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const isExpanded = expandedOrderIds.has(order.id);
            const isEditingPrice = editingPriceId === order.id;
            const isUpdatingStatus = updatingOrderId === order.id;
            const isSavingPrice = savingPriceId === order.id;
            const itemsSubtotal = getItemsSubtotal(order);
            const isPriceAdjusted = adjustedOrderIds.has(order.id) || Math.abs(Number(order.total_amount || 0) - itemsSubtotal) > 0.01;

            return (
              <article key={order.id} className="overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm transition duration-200 hover:border-[#9C6644]/40 hover:shadow-md">
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <button type="button" onClick={() => toggleOrder(order.id)} className="mt-1 rounded-md p-1 text-[#B8BAB7] transition hover:bg-[#24272A] hover:text-[#F1F3EF]" aria-expanded={isExpanded} aria-label={isExpanded ? 'Collapse order' : 'Expand order'}>
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold text-[#F1F3EF]">Order {order.id}</p>
                      <p className="mt-1 text-sm text-[#B8BAB7]">{order.customer_name || 'Unnamed customer'}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-[#858884]"><Calendar className="h-3.5 w-3.5" aria-hidden="true" /> {order.created_at ? new Date(order.created_at).toLocaleString() : 'Date unavailable'}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                    {normalizeStatus(order.status) === 'Pending' && (
                      <button type="button" onClick={() => updateStatus(order.id, 'Confirmed')} disabled={isUpdatingStatus} className="inline-flex items-center gap-1.5 rounded-lg bg-[#9C6644] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-60">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirm order
                      </button>
                    )}
                    <select value={normalizeStatus(order.status)} onChange={(event) => updateStatus(order.id, event.target.value)} disabled={isUpdatingStatus} className={`order-status-select rounded-full border px-3 py-1.5 text-xs font-bold outline-none ${statusClass(order.status)}`} aria-label={`Update status for order ${order.id}`}>
                      {getStatusOptions(order).map((option) => <option key={option.value} value={option.value} className="order-status-option">{option.label}</option>)}
                    </select>
                    {isUpdatingStatus && <LoaderCircle className="h-4 w-4 animate-spin text-[#9C6644]" aria-label="Updating status" />}

                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wider text-[#858884]">{normalizeStatus(order.status) === 'Completed' ? 'Amount paid' : 'Order total'}</p>
                      <p className="font-bold text-[#F1F3EF]">{formatMoney(order.total_amount)}</p>
                    </div>
                    {isPriceAdjusted && <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-[11px] font-bold text-purple-300">Price Adjusted</span>}
                    <button type="button" onClick={() => downloadReceiptPdf(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#4A5568]/50 px-3 py-2 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]" title="Download PDF receipt">
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> PDF receipt
                    </button>
                    <button type="button" onClick={() => emailReceipt(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#4A5568]/50 px-3 py-2 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]" title="Email receipt to customer">
                      <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email
                    </button>
                    <button type="button" onClick={() => beginPriceEdit(order)} className="inline-flex items-center gap-1 rounded-lg border border-[#4A5568]/50 px-3 py-2 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]"><Edit3 className="h-3.5 w-3.5" /> Edit paid amount</button>
                  </div>
                </div>

                {isEditingPrice && (
                  <div className="flex flex-col gap-3 border-t border-[#24272A] bg-[#0B0B0C] p-4 sm:flex-row sm:items-end">
                    <label className="flex-1 text-sm font-semibold text-[#B8BAB7]">Final amount paid
                      <input type="number" min="0" step="0.01" value={priceDraft} onChange={(event) => setPriceDraft(event.target.value)} className="mt-2 w-full rounded-lg border border-[#24272A] bg-[#17191C] px-3 py-2 text-[#F1F3EF] outline-none focus:border-[#9C6644]" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => savePrice(order.id)} disabled={isSavingPrice} className="inline-flex items-center gap-2 rounded-lg bg-[#9C6644] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#8A5A3C] disabled:opacity-60">{isSavingPrice ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</button>
                      <button type="button" onClick={cancelPriceEdit} className="inline-flex items-center gap-2 rounded-lg border border-[#24272A] px-4 py-2 text-sm font-semibold text-[#B8BAB7] transition hover:bg-[#24272A]"><X className="h-4 w-4" /> Cancel</button>
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="grid gap-6 border-t border-[#24272A] bg-[#0F1011] p-5 lg:grid-cols-3">
                    <div className="space-y-3 text-sm">
                      <h2 className="font-semibold text-[#F1F3EF]">Customer contact</h2>
                      <p className="flex items-start gap-2 text-[#B8BAB7]"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.customer_name || 'Not provided'}</p>
                      <p className="flex items-start gap-2 break-all text-[#B8BAB7]"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.customer_email || 'Not provided'}</p>
                      <p className="flex items-start gap-2 text-[#B8BAB7]"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.customer_phone || 'Not provided'}</p>
                    </div>

                    <div className="space-y-3 text-sm">
                      <h2 className="font-semibold text-[#F1F3EF]">Delivery and payment</h2>
                      <p className="flex items-start gap-2 text-[#B8BAB7]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.fulfillment_method === 'DOOR_PICKUP' ? 'Door pickup' : 'Delivery is offered'}</p>
                      <p className="flex items-start gap-2 text-[#B8BAB7]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.delivery_address || 'Not provided'}</p>
                      <p className="flex items-start gap-2 text-[#B8BAB7]"><CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" /> {order.payment_method || 'Not provided'}</p>
                      <div className="space-y-2 border-t border-[#24272A] pt-3">
                        <h3 className="font-semibold text-[#F1F3EF]">Delivery assignment</h3>
                        <label className="block text-xs text-[#858884]">Contact name
                          <input value={deliveryDrafts[order.id]?.name ?? order.delivery_assignee_name ?? ''} onChange={(event) => setDeliveryDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], name: event.target.value } }))} maxLength={120} disabled={!deliveryFieldsReady} className="mt-1 min-h-10 w-full rounded-lg border border-[#3A3D40] bg-[#17191C] px-3 text-sm text-[#F1F3EF] outline-none focus:border-[#9C6644] disabled:opacity-50" placeholder="Driver / pickup contact" />
                        </label>
                        <label className="block text-xs text-[#858884]">Contact phone
                          <input type="tel" value={deliveryDrafts[order.id]?.phone ?? order.delivery_assignee_phone ?? ''} onChange={(event) => setDeliveryDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], phone: event.target.value } }))} maxLength={32} disabled={!deliveryFieldsReady} className="mt-1 min-h-10 w-full rounded-lg border border-[#3A3D40] bg-[#17191C] px-3 text-sm text-[#F1F3EF] outline-none focus:border-[#9C6644] disabled:opacity-50" placeholder="+1 555 000 0000" />
                        </label>
                        <button type="button" onClick={() => void saveDeliveryAssignment(order)} disabled={!deliveryFieldsReady || savingDeliveryId === order.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#9C6644] px-3 text-xs font-semibold text-white hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-50">{savingDeliveryId === order.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save assignment</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-[#24272A] pt-3">
                        <label className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#3A3D40] px-3 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-white ${!deliveryFieldsReady || uploadingDocumentId === order.id ? 'pointer-events-none opacity-50' : ''}`}>
                          {uploadingDocumentId === order.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          {uploadingDocumentId === order.id ? 'Uploading…' : 'Attach document'}
                          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!deliveryFieldsReady || uploadingDocumentId === order.id} className="sr-only" onChange={(event) => { void uploadDeliveryDocument(order, event.target.files?.[0]); event.target.value = ''; }} />
                        </label>
                        {order.delivery_document_path && <button type="button" onClick={() => void openDeliveryDocument(order.delivery_document_path)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#3A3D40] px-3 text-xs font-semibold text-[#B8BAB7] hover:border-[#9C6644] hover:text-white"><FileText className="h-3.5 w-3.5" />View document<ExternalLink className="h-3 w-3" /></button>}
                      </div>
                    </div>

                    <div className="space-y-3 text-sm lg:col-span-1">
                      <h2 className="font-semibold text-[#F1F3EF]">Ordered appliances</h2>
                      {(order.order_items ?? []).length === 0 ? <p className="text-[#858884]">No line items found.</p> : (order.order_items ?? []).map((item) => {
                        const product = item.products || {};
                        const itemName = item.product_name || product.name || 'Appliance';
                        const itemImages = item.product_images || product.images;
                        const image = getImages(itemImages)[0];
                        return (
                          <div key={item.id} className="flex items-center gap-3 rounded-lg border border-[#24272A] bg-[#17191C] p-2.5">
                            {image ? <img src={image} alt={itemName} className="h-11 w-11 rounded object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded bg-[#24272A] text-[#858884]"><Package className="h-5 w-5" /></div>}
                            <div className="min-w-0 flex-1"><p className="truncate font-semibold text-[#F1F3EF]">{itemName}</p><p className="text-xs text-[#858884]">Qty {item.quantity} · {formatMoney(item.price_at_time)} each</p></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!loading && totalOrders > ORDERS_PAGE_SIZE && <nav className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#24272A] bg-[#17191C] px-4 py-3" aria-label="Order pages">
        <p className="text-xs text-[#858884]">Showing {page * ORDERS_PAGE_SIZE + 1}–{Math.min((page + 1) * ORDERS_PAGE_SIZE, totalOrders)} of {totalOrders} orders</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} className="min-h-10 rounded-lg border border-[#3A3D40] px-3 text-sm text-[#B8BAB7] hover:border-[#9C6644] disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
          <button type="button" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * ORDERS_PAGE_SIZE >= totalOrders} className="min-h-10 rounded-lg border border-[#3A3D40] px-3 text-sm text-[#B8BAB7] hover:border-[#9C6644] disabled:cursor-not-allowed disabled:opacity-40">Next</button>
        </div>
      </nav>}
    </section>
  );
}
