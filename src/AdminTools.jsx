import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Users,
  Wrench,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import { downloadProtectedExport, downloadXlsxExport } from './secureExports';

const formatMoney = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(Number(amount) || 0);

const normalizeStatus = (status) => {
  const value = String(status || 'Pending').trim().toLowerCase();
  if (value.includes('cancel')) return 'CANCELLED';
  if (value.includes('complete') || value.includes('deliver') || value.includes('picked')) return 'COMPLETED';
  if (value.includes('confirm') || value.includes('process')) return 'CONFIRMED';
  return 'PENDING';
};

const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';

const isValidExportPin = (pin) => /^\d{4}$/.test(pin) || pin.length >= 8;

export default function AdminTools() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');
  const [pendingExport, setPendingExport] = useState(null);
  const [exportPin, setExportPin] = useState('');
  const [showExportPin, setShowExportPin] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportingFormat, setExportingFormat] = useState('');

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');

    const [productsResult, ordersResult, membersResult] = await Promise.all([
      // The production products table does not include a SKU column. Keep
      // this query aligned with the live schema; SKU remains optional in XLSX
      // output and other admin views can still display a fallback value.
      supabase.from('products').select('id, name, category, price, stock, created_at').order('name'),
      supabase.from('orders').select('id, customer_name, customer_email, total_amount, status, fulfillment_method, created_at').order('created_at', { ascending: false }),
      supabase.from('members').select('id, email, full_name, created_at').order('created_at', { ascending: false })
    ]);

    const failures = [productsResult, ordersResult, membersResult]
      .filter((result) => result.error)
      .map((result) => result.error.message);

    setProducts(productsResult.data ?? []);
    setOrders(ordersResult.data ?? []);
    setMembers(membersResult.data ?? []);
    setLastUpdated(new Date());

    if (failures.length) {
      const message = `Some admin data could not be loaded: ${failures.join(' ')}`;
      setError(message);
      if (!silent) toast.error(message);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const refreshTimer = window.setInterval(() => loadData(true), 30000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const trackedOrders = useMemo(() => orders.filter((order) => normalizeStatus(order.status) !== 'CANCELLED'), [orders]);
  const activeOrders = useMemo(() => trackedOrders.filter((order) => {
    const status = normalizeStatus(order.status);
    return status === 'PENDING' || status === 'CONFIRMED';
  }), [trackedOrders]);
  const pendingOrders = useMemo(() => activeOrders.filter((order) => normalizeStatus(order.status) === 'PENDING'), [activeOrders]);
  const completedOrders = useMemo(() => trackedOrders.filter((order) => normalizeStatus(order.status) === 'COMPLETED'), [trackedOrders]);
  const completedRevenue = useMemo(() => completedOrders
    .reduce((total, order) => total + Number(order.total_amount || 0), 0), [completedOrders]);
  const pendingValue = useMemo(() => pendingOrders.reduce((total, order) => total + Number(order.total_amount || 0), 0), [pendingOrders]);
  const lowStockProducts = useMemo(() => [...products]
    .filter((product) => Number(product.stock || 0) <= 10)
    .sort((left, right) => Number(left.stock || 0) - Number(right.stock || 0)), [products]);

  const exportDefinitions = {
    inventory: {
      title: 'Inventory records',
      xlsxFilename: 'wenappliances-inventory.xlsx',
      protectedFilename: 'wenappliances-inventory-protected.html',
      columns: [
        { key: 'name', label: 'Product name' },
        { key: 'sku', label: 'SKU (optional)' },
        { key: 'category', label: 'Category' },
        { key: 'price', label: 'Price USD' },
        { key: 'stock', label: 'Stock' },
        { key: 'status', label: 'Status (optional)' },
        { key: 'created_at', label: 'Created' }
      ],
      rows: products
    },
    orders: {
      title: 'Order records',
      xlsxFilename: 'wenappliances-orders.xlsx',
      protectedFilename: 'wenappliances-orders-protected.html',
      columns: [
        { key: 'id', label: 'Order ID' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'customer_email', label: 'Email' },
        { key: 'total_amount', label: 'Total USD' },
        { key: 'status', label: 'Status' },
        { key: 'fulfillment_method', label: 'Fulfillment' },
        { key: 'created_at', label: 'Placed' }
      ],
      rows: orders
    },
    members: {
      title: 'Member records',
      xlsxFilename: 'wenappliances-members.xlsx',
      protectedFilename: 'wenappliances-members-protected.html',
      columns: [
        { key: 'full_name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'created_at', label: 'Joined' }
      ],
      rows: members
    }
  };

  const openExportDialog = (exportKey) => {
    setPendingExport(exportDefinitions[exportKey]);
    setExportPin('');
    setExportError('');
    setShowExportPin(false);
  };

  const closeExportDialog = (force = false) => {
    if (exportingFormat && !force) return;
    setPendingExport(null);
    setExportPin('');
    setExportError('');
    setShowExportPin(false);
  };

  const handleExport = async (format) => {
    if (!pendingExport) return;
    const pin = exportPin.trim();
    if (!isValidExportPin(pin)) {
      setExportError('Enter a 4-digit PIN or a password with at least 8 characters.');
      return;
    }

    setExportError('');
    setExportingFormat(format);
    try {
      if (format === 'xlsx') {
        downloadXlsxExport({
          filename: pendingExport.xlsxFilename,
          title: pendingExport.title,
          columns: pendingExport.columns,
          rows: pendingExport.rows
        });
        toast.success(`${pendingExport.title} XLSX workbook downloaded.`);
      } else {
        await downloadProtectedExport({
          filename: pendingExport.protectedFilename,
          title: pendingExport.title,
          columns: pendingExport.columns,
          rows: pendingExport.rows,
          pin
        });
        toast.success('Protected report downloaded. The PIN is required to open it.');
      }
      closeExportDialog(true);
    } catch (exportFailure) {
      const message = exportFailure instanceof Error ? exportFailure.message : 'The export could not be created.';
      setExportError(message);
      toast.error(message);
    } finally {
      setExportingFormat('');
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="admin-tools-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Administration</p>
          <h1 id="admin-tools-title" className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#F1F3EF]"><Wrench className="h-6 w-6 text-[#9C6644]" /> Admin tools</h1>
          <p className="mt-1 text-sm text-[#858884]">Operational summaries and downloadable records for WenAppliances.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-xs text-[#858884]">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button type="button" onClick={() => loadData()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#4A5568]/50 bg-[#17191C] px-3 py-2 text-sm font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF] disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh data
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200" role="alert">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ToolMetric icon={Boxes} label="Catalog products" value={products.length} />
        <ToolMetric icon={ClipboardList} label="Active orders" value={activeOrders.length} />
        <ToolMetric icon={Users} label="Customer members" value={members.length} />
        <ToolMetric icon={ClipboardList} label="Pending order value" value={formatMoney(pendingValue)} detail={`${pendingOrders.length} awaiting confirmation`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#24272A] bg-[#17191C] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[#F1F3EF]">Download records</h2>
              <p className="mt-1 text-sm text-[#858884]">Branded XLSX workbooks and PIN-protected reports for bookkeeping and stock planning.</p>
            </div>
            <Download className="h-5 w-5 text-[#9C6644]" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <ExportButton label="Inventory XLSX" onClick={() => openExportDialog('inventory')} disabled={loading || !products.length} />
            <ExportButton label="Orders XLSX" onClick={() => openExportDialog('orders')} disabled={loading || !orders.length} />
            <ExportButton label="Members XLSX" onClick={() => openExportDialog('members')} disabled={loading || !members.length} />
          </div>
          <p className="mt-4 text-xs leading-5 text-[#858884]">Each download asks for a 4-digit PIN or password. Choose the protected report if the file must ask for that PIN again when opened.</p>
        </div>

        <div className="rounded-xl border border-[#24272A] bg-[#17191C] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[#F1F3EF]">Cash collected</h2>
              <p className="mt-1 text-sm text-[#858884]">Completed orders only; pending and cancelled orders are excluded.</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{formatMoney(completedRevenue)}</p>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#24272A]">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${trackedOrders.length ? Math.min(100, (completedOrders.length / trackedOrders.length) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-[#858884]">{completedOrders.length} of {trackedOrders.length} non-cancelled orders completed</p>
        </div>
      </div>

      <div className="rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#24272A] p-5">
          <div>
            <h2 className="font-semibold text-[#F1F3EF]">Low-stock watchlist</h2>
            <p className="mt-1 text-sm text-[#858884]">Products with ten or fewer units remaining.</p>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">{lowStockProducts.length} needs attention</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center p-10 text-sm text-[#858884]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading inventory...</div>
        ) : lowStockProducts.length === 0 ? (
          <p className="p-10 text-center text-sm text-[#858884]">Inventory levels are healthy.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[#0B0B0C] text-xs uppercase tracking-wider text-[#858884]"><tr><th className="px-5 py-3 font-medium">Product</th><th className="px-5 py-3 font-medium">Category</th><th className="px-5 py-3 text-right font-medium">Price</th><th className="px-5 py-3 text-right font-medium">Remaining</th></tr></thead>
              <tbody className="divide-y divide-[#24272A]">
                {lowStockProducts.slice(0, 12).map((product) => <tr key={product.id} className="hover:bg-[#1D2023]"><td className="px-5 py-3 font-semibold text-[#F1F3EF]">{product.name || 'Unnamed appliance'}</td><td className="px-5 py-3 text-[#B8BAB7]">{product.category || 'Other'}</td><td className="px-5 py-3 text-right text-[#B8BAB7]">{formatMoney(product.price)}</td><td className={`px-5 py-3 text-right font-bold ${Number(product.stock || 0) <= 0 ? 'text-red-400' : 'text-amber-300'}`}>{Number(product.stock || 0)}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#24272A] bg-[#17191C] shadow-sm">
        <div className="border-b border-[#24272A] p-5"><h2 className="font-semibold text-[#F1F3EF]">Latest orders</h2><p className="mt-1 text-sm text-[#858884]">A quick view before opening full Order Management.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-[#0B0B0C] text-xs uppercase tracking-wider text-[#858884]"><tr><th className="px-5 py-3 font-medium">Order</th><th className="px-5 py-3 font-medium">Customer</th><th className="px-5 py-3 font-medium">Placed</th><th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead>
            <tbody className="divide-y divide-[#24272A]">
              {orders.slice(0, 8).map((order) => <tr key={order.id} className="hover:bg-[#1D2023]"><td className="px-5 py-3 font-mono text-xs text-[#B8BAB7]">{order.id}</td><td className="px-5 py-3 text-[#F1F3EF]">{order.customer_name || 'Unnamed customer'}</td><td className="px-5 py-3 text-[#858884]">{formatDate(order.created_at)}</td><td className="px-5 py-3"><span className="rounded-full border border-[#4A5568]/50 px-2.5 py-1 text-xs font-semibold text-[#B8BAB7]">{normalizeStatus(order.status)}</span></td><td className="px-5 py-3 text-right font-semibold text-[#F1F3EF]">{formatMoney(order.total_amount)}</td></tr>)}
              {!loading && !orders.length && <tr><td colSpan="5" className="p-8 text-center text-sm text-[#858884]">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {pendingExport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeExportDialog(); }}>
          <div className="w-full max-w-lg rounded-2xl border border-[#3A3F44] bg-[#17191C] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-security-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="mb-3 inline-flex rounded-xl bg-[#9C6644]/15 p-3 text-[#C0835A]"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
                <h2 id="export-security-title" className="text-xl font-bold text-[#F1F3EF]">Secure {pendingExport.title.toLowerCase()}</h2>
                <p className="mt-2 text-sm leading-6 text-[#B8BAB7]">Enter a 4-digit PIN or password before downloading. The protected report encrypts the records and requests this PIN again when opened.</p>
              </div>
              <button type="button" onClick={closeExportDialog} disabled={Boolean(exportingFormat)} className="rounded-lg p-2 text-[#858884] transition hover:bg-[#24272A] hover:text-[#F1F3EF] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Close export security dialog"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-6">
              <label htmlFor="export-security-pin" className="text-sm font-semibold text-[#F1F3EF]">Export PIN or password</label>
              <div className="relative mt-2">
                <input id="export-security-pin" type={showExportPin ? 'text' : 'password'} value={exportPin} onChange={(event) => { setExportPin(event.target.value); setExportError(''); }} autoFocus autoComplete="new-password" inputMode="numeric" placeholder="4-digit PIN or strong password" className="w-full rounded-lg border border-[#4A5568]/70 bg-[#0B0B0C] px-3 py-3 pr-11 text-[#F1F3EF] outline-none transition placeholder:text-[#697078] focus:border-[#9C6644]" />
                <button type="button" onClick={() => setShowExportPin((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#858884] hover:bg-[#24272A] hover:text-[#F1F3EF]" aria-label={showExportPin ? 'Hide export PIN' : 'Show export PIN'}>{showExportPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              {exportError && <p className="mt-2 text-sm text-red-300" role="alert">{exportError}</p>}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => handleExport('xlsx')} disabled={Boolean(exportingFormat)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#4A5568]/60 bg-[#0B0B0C] px-4 py-3 text-sm font-semibold text-[#F1F3EF] transition hover:-translate-y-0.5 hover:border-[#9C6644] disabled:cursor-not-allowed disabled:opacity-50">{exportingFormat === 'xlsx' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download XLSX</button>
              <button type="button" onClick={() => handleExport('protected')} disabled={Boolean(exportingFormat)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#9C6644] px-4 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#B8754B] disabled:cursor-not-allowed disabled:opacity-50">{exportingFormat === 'protected' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />} Protected report</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ToolMetric({ icon: Icon, label, value, detail }) {
  return <div className="rounded-xl border border-[#24272A] bg-[#17191C] p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><p className="text-sm text-[#858884]">{label}</p><span className="rounded-lg bg-[#24272A] p-2 text-[#9C6644]"><Icon className="h-4 w-4" /></span></div><p className="mt-4 break-words text-2xl font-bold text-[#F1F3EF]">{value}</p>{detail && <p className="mt-1 text-xs text-[#858884]">{detail}</p>}</div>;
}

function ExportButton({ label, onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#4A5568]/50 px-3 py-2 text-xs font-semibold text-[#B8BAB7] transition hover:border-[#9C6644] hover:text-[#F1F3EF] disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" /> {label}</button>;
}
