import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  Edit3,
  LoaderCircle,
  Mail,
  MapPin,
  Package,
  Phone,
  Save,
  UserRound,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

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

const buildReceiptText = (order) => {
  const items = (order.order_items ?? []).map((item) => {
    const name = item.product_name || item.products?.name || 'Appliance';
    const lineTotal = Number(item.price_at_time || 0) * Number(item.quantity || 0);
    return `${name} x ${item.quantity} — ${formatMoney(lineTotal)}`;
  });

  return [
    'WenAppliances Receipt',
    '=====================',
    `Order: ${order.id}`,
    `Date: ${order.created_at ? new Date(order.created_at).toLocaleString() : 'Unavailable'}`,
    `Customer: ${order.customer_name || 'Not provided'}`,
    `Email: ${order.customer_email || 'Not provided'}`,
    `Fulfillment: ${order.fulfillment_method === 'DOOR_PICKUP' ? 'Door pickup' : 'Delivery is offered'}`,
    `Status: ${statusLabel(order.status, order.fulfillment_method)}`,
    ...(order.cancellation_reason ? [`Cancellation reason: ${order.cancellation_reason}`] : []),
    '',
    'Items',
    '-----',
    ...(items.length ? items : ['No line items found.']),
    '',
    `Total: ${formatMoney(order.total_amount)}`,
    '',
    'Thank you for choosing WenAppliances.'
  ].join('\n');
};

const downloadReceipt = (order) => {
  const blob = new Blob([buildReceiptText(order)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `WenAppliances-receipt-${order.id}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const emailReceipt = (order) => {
  if (!order.customer_email) {
    toast.error('This order does not have a customer email address.');
    return;
  }

  const subject = `WenAppliances receipt - ${order.id}`;
  window.location.href = `mailto:${order.customer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildReceiptText(order))}`;
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());
  const [updatingOrderId, setUpdatingOrderId] = useState('');
  const [editingPriceId, setEditingPriceId] = useState('');
  const [priceDraft, setPriceDraft] = useState('');
  const [savingPriceId, setSavingPriceId] = useState('');
  const [adjustedOrderIds, setAdjustedOrderIds] = useState(new Set());

  useEffect(() => {
    let active = true;

    const fetchOrders = async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError('');
      }

      const { data, error: fetchError } = await supabase
        .from('orders')
        .select(`
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
        `)
        .order('created_at', { ascending: false });

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
      }

      if (!silent) setLoading(false);
    };

    fetchOrders();

    const refreshTimer = window.setInterval(() => fetchOrders(true), 10000);
    const ordersChannel = supabase
      .channel(`admin-orders-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders(true))
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(ordersChannel);
    };
  }, []);

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
      } else {
        toast.success(`Order updated: ${statusLabel(normalizedNewStatus, currentOrder?.fulfillment_method)}.`);
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

  const orderCountLabel = useMemo(() => `${orders.length} active order${orders.length === 1 ? '' : 's'}`, [orders.length]);

  return (
    <section className="space-y-6" aria-labelledby="admin-orders-title">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Operations</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="admin-orders-title" className="text-2xl font-bold tracking-tight text-[#F1F3EF]">Order management</h1>
            <p className="mt-1 text-sm text-[#858884]">Review customer details, update fulfillment status, and record negotiated pricing.</p>
          </div>
          {!loading && <span className="rounded-full border border-[#24272A] bg-[#17191C] px-3 py-1 text-xs font-semibold text-[#B8BAB7]">{orderCountLabel}</span>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300" role="alert">{error}</div>}

      {loading ? (
        <div className="space-y-4" aria-label="Loading orders">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-[#24272A] bg-[#17191C]" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#4A5568] bg-[#17191C] p-12 text-center">
          <Package className="mx-auto h-10 w-10 text-[#858884]" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-[#F1F3EF]">No orders yet</h2>
          <p className="mt-2 text-sm text-[#858884]">New customer orders will appear here after checkout.</p>
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
              <article key={order.id} className="overflow-hidden rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
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
                    <button type="button" onClick={() => downloadReceipt(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#4A5568]/50 px-3 py-2 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF]" title="Download receipt">
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Receipt
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
    </section>
  );
}
