import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Truck,
  XCircle,
  Ban
} from 'lucide-react';
import { supabase } from './supabaseClient';
import {
  downloadReceiptPdf,
  formatReceiptDate,
  formatReceiptMoney,
  getReceiptItems,
  getReceiptStatusLabel
} from './receiptPdf';

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0);

const formatDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
};

const getImages = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
  } catch {
    return [value];
  }
};

const getFunctionErrorMessage = async (error) => {
  if (error?.context && typeof error.context.clone === 'function') {
    try {
      const response = await error.context.clone();
      const body = await response.json();
      if (body?.error) return body.error;
    } catch {
      // Fall back to the client error below.
    }
  }

  return error?.message || 'We could not find purchases for that email.';
};

const normalizeStatus = (status) => {
  const value = String(status || 'Pending').trim().toLowerCase();
  if (value === 'cancelled') return 'Cancelled';
  if (value === 'completed' || value === 'complete' || value === 'delivered' || value === 'delivered & paid' || value === 'picked' || value === 'picked & paid') return 'Completed';
  if (value === 'confirmed' || value === 'paid & confirmed' || value === 'processing') return 'Confirmed';
  return 'Pending';
};

const getFinalStatusLabel = (fulfillmentMethod) => fulfillmentMethod === 'DOOR_PICKUP' ? 'Picked & Paid' : 'Delivered & Paid';

const getStatusSteps = (fulfillmentMethod) => ['Pending', 'Confirmed', getFinalStatusLabel(fulfillmentMethod)];

const getStatusIndex = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'Cancelled') return -1;
  if (normalized === 'Completed') return 2;
  if (normalized === 'Confirmed') return 1;
  return 0;
};

const getStatusLabel = (status, fulfillmentMethod) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'Completed') return getFinalStatusLabel(fulfillmentMethod);
  if (normalized === 'Confirmed') return 'Confirmed';
  return 'Pending';
};

const getStatusMessage = (status, fulfillmentMethod) => {
  const normalized = normalizeStatus(status);
  const fulfillment = fulfillmentMethod === 'DOOR_PICKUP' ? 'door pickup' : 'delivery';
  if (normalized === 'Completed') return fulfillmentMethod === 'DOOR_PICKUP' ? 'Your order has been picked up and paid for. Your purchase is complete.' : 'Your order has been delivered and paid for. Your purchase is complete.';
  if (normalized === 'Confirmed') return `Your order is confirmed and awaiting ${fulfillment}.`;
  return 'Your order is awaiting confirmation from WenAppliances.';
};

function OrderStatus({ status, fulfillmentMethod, cancellationReason }) {
  const normalizedStatus = normalizeStatus(status);
  const currentIndex = getStatusIndex(normalizedStatus);
  const isCancelled = normalizedStatus === 'Cancelled';
  const statusSteps = getStatusSteps(fulfillmentMethod);

  if (isCancelled) {
    return (
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          This order has been cancelled.
          {cancellationReason ? ` Reason: ${cancellationReason}` : ' Please contact support if you need help.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-[#E5E4E0] bg-[#F4F3EF] px-4 py-5 sm:px-6">
      <div className="relative grid grid-cols-3 gap-2">
        <div className="pointer-events-none absolute left-[16.6667%] right-[16.6667%] top-4 h-1 -translate-y-1/2 rounded-full bg-[#D7D8D3]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute left-[16.6667%] top-4 h-1 -translate-y-1/2 rounded-full bg-[#2563EB] transition-all duration-500"
          style={{ width: `${currentIndex <= 0 ? 0 : `${(currentIndex / (statusSteps.length - 1)) * 66.6667}%`}` }}
          aria-hidden="true"
        />
        {statusSteps.map((step, index) => {
          const complete = currentIndex >= index;
          const current = currentIndex === index;
          return (
            <div key={step} className="relative z-10 flex min-w-0 flex-col items-center text-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border-4 border-[#F4F3EF] ${complete ? 'bg-[#2563EB] text-white' : 'bg-[#D7D8D3] text-[#697078]'}`}>
                {complete ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock3 className="h-4 w-4" aria-hidden="true" />}
              </div>
              <span className={`mt-2 max-w-[7rem] text-[11px] font-bold leading-tight sm:text-xs ${complete ? 'text-[#1D4ED8]' : 'text-[#697078]'}`}>{step}</span>
              <span className="mt-1 hidden text-[10px] text-[#858884] sm:block">{current ? 'Current status' : complete ? 'Complete' : 'Waiting'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReceiptPreview({ order }) {
  const items = getReceiptItems(order);
  const statusLabel = getReceiptStatusLabel(order);

  return (
    <div className="relative mt-4 overflow-hidden rounded-xl border border-[#D9E7F7] bg-white p-5 text-[#111214] shadow-inner">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.055]" aria-hidden="true">
        <span className="rotate-[-24deg] text-3xl font-black tracking-[0.18em] text-[#9C6644]">WENAPPLIANCES</span>
      </div>
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5E4E0] pb-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#9C6644] font-serif text-xl text-white">W</span>
            <span className="text-lg font-bold"><span className="text-[#111214]">Wen</span><span className="text-[#9C6644]">Appliances</span></span>
          </div>
          <div className="text-right text-xs text-[#4A5568]">
            <p className="font-bold uppercase tracking-wider text-[#9C6644]">Purchase receipt</p>
            <p className="mt-1">{formatReceiptDate(order.createdAt)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-xs text-[#4A5568] sm:grid-cols-2">
          <div><p className="font-bold uppercase tracking-wider text-[#858884]">Customer</p><p className="mt-1 font-semibold text-[#111214]">{order.customerName || 'Not provided'}</p><p>{order.customerEmail || 'Not provided'}</p><p className="flex items-center gap-1"><Phone className="h-3 w-3 text-[#9C6644]" aria-hidden="true" /> {order.customerPhone || 'Not provided'}</p></div>
          <div><p className="font-bold uppercase tracking-wider text-[#858884]">Order status</p><p className="mt-1 font-semibold text-[#1D4ED8]">{statusLabel}</p><p>{order.fulfillmentMethod === 'DOOR_PICKUP' ? 'Door pickup' : 'Delivery is offered'}</p><p>{order.paymentMethod || 'Payment method unavailable'}</p></div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-lg border border-[#E5E4E0]">
          <table className="w-full min-w-[420px] text-left text-xs"><thead className="bg-[#F4EEE8] text-[10px] uppercase tracking-wider text-[#4A5568]"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-center">Qty</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-[#E5E4E0]">{items.map((item) => <tr key={`${item.name}-${item.quantity}`}><td className="px-3 py-2 font-semibold">{item.name}</td><td className="px-3 py-2 text-center">{item.quantity}</td><td className="px-3 py-2 text-right">{formatReceiptMoney(item.unitPrice)}</td><td className="px-3 py-2 text-right font-semibold">{formatReceiptMoney(item.total)}</td></tr>)}</tbody></table>
        </div>
        <div className="mt-4 flex justify-end border-t border-[#E5E4E0] pt-4"><p className="text-right"><span className="block text-[10px] font-bold uppercase tracking-wider text-[#858884]">Total recorded</span><span className="text-xl font-bold text-[#111214]">{formatReceiptMoney(order.totalAmount)}</span></p></div>
      </div>
    </div>
  );
}

function OrderCard({ order, onCancel, cancelling, expanded, onToggle }) {
  const status = normalizeStatus(order.status);
  const isCancelled = status === 'Cancelled';
  const isFinalStatus = status === 'Completed';
  const [showReceipt, setShowReceipt] = useState(false);

  return (
    <article className="rounded-2xl border border-[#E5E4E0] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 border-b border-[#E5E4E0] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" onClick={() => onToggle?.(order.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-expanded={expanded} aria-controls={`order-details-${order.id}`}>
          <span className="mt-0.5 rounded-md border border-[#E5E4E0] bg-[#F4F3EF] p-1.5 text-[#9C6644]">
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Purchase</p>
          <h2 className="mt-2 break-all font-mono text-sm font-bold text-[#111214]">Order reference: {order.id}</h2>
          <p className="mt-2 text-sm text-[#858884]">Placed {formatDate(order.createdAt)}</p>
          <span className="mt-2 block text-xs font-semibold text-[#9C6644]">{expanded ? 'Hide order details' : 'View order details'}</span>
          </span>
        </button>
        <div className={`flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-bold ${isCancelled ? 'border-red-200 bg-red-50 text-red-800' : 'border-[#9C6644]/30 bg-[#9C6644]/10 text-[#8A5A3C]'}`}>
          {isCancelled ? <XCircle className="h-4 w-4" aria-hidden="true" /> : <PackageCheck className="h-4 w-4" aria-hidden="true" />}
          {getStatusLabel(status, order.fulfillmentMethod)}
        </div>
      </div>

      {expanded && <div id={`order-details-${order.id}`}>
        {status === 'Pending' && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">Need to change this order? You can cancel it while it is still pending.</p>
            <button type="button" onClick={() => onCancel?.(order.id)} disabled={cancelling} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
              {cancelling ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
              {cancelling ? 'Cancelling...' : 'Cancel order'}
            </button>
          </div>
        )}

        <OrderStatus status={status} fulfillmentMethod={order.fulfillmentMethod} cancellationReason={order.cancellationReason} />
        {!isCancelled && <p className="mt-4 rounded-xl border border-[#9C6644]/20 bg-[#9C6644]/10 p-4 text-sm font-semibold text-[#8A5A3C]">
          {getStatusMessage(status, order.fulfillmentMethod)}
        </p>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <h3 className="border-b border-[#E5E4E0] pb-3 text-lg font-bold text-[#111214]">Products in this order</h3>
          <div className="divide-y divide-[#E5E4E0]">
            {(order.items || []).map((item) => {
              const image = getImages(item.images)[0];
              return (
                <div key={item.id} className="flex gap-4 py-4">
                  {image ? <img src={image} alt={item.name || 'Appliance'} className="product-photo h-16 w-16 rounded-lg border border-[#E5E4E0] bg-[#F4F3EF] object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-[#E5E4E0] bg-[#F4F3EF]"><PackageCheck className="h-6 w-6 text-[#9C6644]" aria-hidden="true" /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#111214]">{item.name || 'Appliance'}</p>
                    <p className="mt-1 text-sm text-[#858884]">Quantity: {item.quantity}</p>
                  </div>
                  <p className="font-semibold text-[#111214]">{formatMoney(Number(item.priceAtTime) * Number(item.quantity))}</p>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="h-fit rounded-xl bg-[#F4F3EF] p-5 text-sm">
          <h3 className="text-base font-bold text-[#111214]">Order summary</h3>
          <div className="mt-4 space-y-2 text-[#4A5568]">
            <div className="flex justify-between gap-4"><span>Payment</span><span className="text-right font-semibold text-[#111214]">{order.paymentMethod || 'Not provided'}</span></div>
            <div className="flex justify-between gap-4"><span>Fulfillment</span><span className="text-right font-semibold text-[#111214]">{order.fulfillmentMethod === 'DOOR_PICKUP' ? 'Door pickup' : 'Delivery is offered'}</span></div>
            <div className="flex justify-between gap-4 border-t border-[#E5E4E0] pt-3 font-bold text-[#111214]"><span>{isFinalStatus ? 'Amount paid' : 'Order total'}</span><span className="text-[#9C6644]">{formatMoney(order.totalAmount)}</span></div>
          </div>
          <p className="mt-5 flex items-start gap-2 border-t border-[#E5E4E0] pt-5 text-[#4A5568]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" aria-hidden="true" /> {order.fulfillmentMethod === 'DOOR_PICKUP' ? 'Pickup arrangements are made by phone or email.' : order.deliveryAddress || 'Delivery address unavailable'}</p>
          <p className="mt-4 flex items-start gap-2 text-[#4A5568]"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-[#9C6644]" aria-hidden="true" /> Status updates appear here after the admin updates your order.</p>
        </aside>
        </div>

        {isFinalStatus && <div className="mt-6 rounded-xl border border-[#2563EB]/20 bg-[#EFF6FF] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#1D4ED8]"><FileText className="h-4 w-4" aria-hidden="true" /> Receipt available</p>
              <p className="mt-1 text-xs text-[#4A5568]">Preview or download the final receipt showing the amount recorded by WenAppliances.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowReceipt((current) => !current)} className="rounded-lg border border-[#2563EB]/30 bg-white px-3 py-2 text-xs font-bold text-[#1D4ED8] hover:bg-[#DBEAFE]">{showReceipt ? 'Hide preview' : 'Preview receipt'}</button>
              <button type="button" onClick={() => downloadReceiptPdf(order)} className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-bold text-white hover:bg-[#1D4ED8]"><Download className="h-3.5 w-3.5" aria-hidden="true" /> Download PDF receipt</button>
            </div>
          </div>
          {showReceipt && <ReceiptPreview order={order} />}
        </div>}
      </div>}
    </article>
  );
}

export default function OrderTracking({ initialValues = null, accountMode = false }) {
  const [formData, setFormData] = useState({
    email: initialValues?.email || '',
    productName: ''
  });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancellingOrderId, setCancellingOrderId] = useState('');
  const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());
  const autoLookupStarted = useRef(false);

  const lookupPurchases = useCallback(async (values, { silent = false } = {}) => {
    const email = values.email.trim().toLowerCase();

    if (!email) {
      setError('Enter the email address used when purchasing.');
      setOrders([]);
      return;
    }

    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const { data, error: functionError } = await supabase.functions.invoke('track-order', {
        body: { email }
      });

      if (functionError) throw new Error(await getFunctionErrorMessage(functionError));
      setOrders(data?.orders || []);
    } catch (lookupError) {
      console.error('Purchase lookup error:', lookupError);
      if (!silent) {
        setOrders([]);
        setError(lookupError.message || 'We could not find purchases for that email.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const initialEmail = initialValues?.email?.trim() || '';

  useEffect(() => {
    if (autoLookupStarted.current || !initialEmail) return;

    autoLookupStarted.current = true;
    setFormData((current) => ({ ...current, email: initialEmail }));
    lookupPurchases({ email: initialEmail });
  }, [initialEmail, lookupPurchases]);

  useEffect(() => {
    const email = formData.email.trim().toLowerCase();
    if (!email) return undefined;

    let active = true;

    const refreshOrders = () => {
      if (!active || document.visibilityState === 'hidden') return;
      lookupPurchases({ email }, { silent: true });
    };

    // Realtime provides the quickest update when an admin changes the order.
    // The interval remains as a reliable fallback if Realtime is unavailable.
    const ordersChannel = supabase
      .channel(`customer-order-status-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `customer_email=eq.${email}`
        },
        refreshOrders
      )
      .subscribe();

    const refreshTimer = window.setInterval(refreshOrders, 5000);
    const handleFocus = () => refreshOrders();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOrders();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(ordersChannel);
    };
  }, [formData.email, lookupPurchases]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await lookupPurchases(formData);
  };

  const cancelOrder = async (orderId) => {
    if (!window.confirm('Cancel this order? This can only be done while the order is still pending.')) return;

    setCancellingOrderId(orderId);
    setError('');

    try {
      const { data, error: cancelError } = await supabase.functions.invoke('cancel-order', {
        body: { email: formData.email.trim(), orderId }
      });

      if (cancelError) throw new Error(await getFunctionErrorMessage(cancelError));

      setOrders((current) => current.map((order) => order.id === orderId ? {
        ...order,
        status: data?.status || 'Cancelled',
        cancellationReason: data?.cancellationReason || 'Cancelled by customer before confirmation.'
      } : order));
    } catch (cancelError) {
      console.error('Order cancellation error:', cancelError);
      setError(cancelError.message || 'We could not cancel this order.');
    } finally {
      setCancellingOrderId('');
    }
  };

  const toggleOrder = (orderId) => {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const searchTerm = formData.productName.trim().toLowerCase();
  const filteredOrders = useMemo(() => orders
    .map((order) => ({
      ...order,
      items: searchTerm
        ? (order.items || []).filter((item) => String(item.name || '').toLowerCase().includes(searchTerm))
        : order.items || []
    }))
    .filter((order) => order.items.length > 0), [orders, searchTerm]);

  return (
    <section className="motion-fade-up mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Your account purchases</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#111214]">{accountMode ? 'My orders' : 'Find a product you ordered'}</h1>
        <p className="mt-3 text-[#4A5568]">{accountMode ? 'View your purchases, search by product name, and cancel an order while it is still pending.' : 'Use the same email from checkout. Your purchases will stay available here, and you can search them by product name.'}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-4 rounded-2xl border border-[#E5E4E0] bg-white p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end md:p-6">
        {accountMode && initialEmail ? (
          <div className="rounded-lg border border-[#E5E4E0] bg-[#F4F3EF] px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-[#111214]"><Mail className="h-4 w-4 text-[#9C6644]" aria-hidden="true" /> Member purchase email</span>
            <p className="mt-1 break-all text-sm text-[#4A5568]">Signed in as {initialEmail}</p>
          </div>
        ) : (
          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#111214]"><Mail className="h-4 w-4 text-[#9C6644]" aria-hidden="true" /> Purchase email</span>
            <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="you@example.com" autoComplete="email" required className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
          </label>
        )}

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[#111214]">Search product name <span className="font-normal text-[#858884]">(optional)</span></span>
          <input name="productName" value={formData.productName} onChange={handleChange} placeholder="e.g. LG fridge" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 text-sm outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
        </label>

        <button type="submit" disabled={loading} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#111214] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#24272A] disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          {loading ? 'Loading...' : accountMode && initialEmail ? 'Refresh purchases' : 'Show my purchases'}
        </button>
      </form>

      {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}

      {orders.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[#111214]">Your purchases</h2>
            <p className="mt-1 text-sm text-[#858884]">{filteredOrders.length} matching order{filteredOrders.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" onClick={() => lookupPurchases(formData)} disabled={loading} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9C6644] hover:underline disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh purchases
          </button>
        </div>
      )}

      {orders.length > 0 && filteredOrders.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-[#C9C7C0] bg-white p-10 text-center">
          <Search className="mx-auto h-8 w-8 text-[#9C6644]" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold text-[#111214]">No product matched</h2>
          <p className="mt-2 text-sm text-[#858884]">Try another product name, or clear the search to see all purchases.</p>
        </div>
      )}

      {filteredOrders.length > 0 && <div className="mt-5 space-y-6">{filteredOrders.map((order) => <OrderCard key={order.id} order={order} expanded={expandedOrderIds.has(order.id)} onToggle={toggleOrder} onCancel={cancelOrder} cancelling={cancellingOrderId === order.id} />)}</div>}

      {!loading && orders.length === 0 && !error && (
        <div className="mt-8 rounded-2xl border border-dashed border-[#C9C7C0] bg-white p-10 text-center">
          <PackageCheck className="mx-auto h-10 w-10 text-[#9C6644]" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold text-[#111214]">Your purchased products will appear here</h2>
          <p className="mt-2 text-sm text-[#858884]">Enter the email used during checkout to load your purchase history.</p>
        </div>
      )}
    </section>
  );
}
