import { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  Lock,
  MapPin,
  Phone,
  UserRound
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';
import { PICKUP_CONTACT_MESSAGE, SUPPORT_EMAIL, SUPPORT_PHONE } from './businessInfo';

const PAYMENT_METHODS = [
  'Credit / Debit Card (Stripe)',
  'Venmo',
  'Cash App',
  'Cash on Delivery'
];

const FULFILLMENT_METHODS = [
  { value: 'DELIVERY', label: 'Delivery', description: 'Delivery is offered.' },
  { value: 'DOOR_PICKUP', label: 'Door pickup', description: 'Arrange a pickup time with our team.' }
];

const initialForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  fulfillmentMethod: '',
  paymentMethod: PAYMENT_METHODS[0]
};

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0);

const getProductId = (item) => item.productId || item.id;

export default function Checkout({ cart = [], cartTotal = 0, clearCart, navigate, onOrderPlaced }) {
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (cart.length === 0) {
      toast.error('Your cart is empty. Add an appliance before checking out.');
      return;
    }

    const invalidItem = cart.find((item) => !getProductId(item));
    if (invalidItem) {
      toast.error('One cart item is missing its product ID. Please refresh your cart and try again.');
      return;
    }

    if (!formData.fulfillmentMethod) {
      toast.error('Please choose delivery or door pickup.');
      return;
    }

    if (formData.fulfillmentMethod === 'DELIVERY' && !formData.address.trim()) {
      toast.error('Please enter a delivery address.');
      return;
    }

    setLoading(true);

    try {
      const { data, error: checkoutError } = await supabase.functions.invoke('create-order', {
        body: {
          customer: {
            name: formData.name.trim(),
            email: formData.email.trim(),
            phone: formData.phone.trim(),
            address: formData.address.trim()
          },
          fulfillmentMethod: formData.fulfillmentMethod,
          paymentMethod: formData.paymentMethod,
          items: cart.map((item) => ({
            productId: getProductId(item),
            quantity: Number(item.quantity)
          }))
        }
      });

      if (checkoutError) {
        console.error('Secure Checkout Error:', checkoutError);
        toast.error(checkoutError.message || 'Failed to place order');
        return;
      }

      if (!data?.orderId) throw new Error('The secure checkout service returned an invalid response.');

      clearCart?.();
      toast.success(`Order placed successfully! Total: ${formatMoney(data.totalAmount)}.`);
      onOrderPlaced?.({ orderId: data.orderId, email: formData.email.trim() });
      navigate?.('/track-order');
    } catch (submitError) {
      console.error('Checkout Error:', submitError);
      toast.error(submitError.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <div className="rounded-2xl border border-[#E5E4E0] bg-white p-10 shadow-sm">
          <h1 className="text-2xl font-bold text-[#111214]">Your cart is empty</h1>
          <p className="mt-3 text-[#4A5568]">Add an appliance before continuing to checkout.</p>
          <button
            type="button"
            onClick={() => navigate?.('/products')}
            className="mt-6 rounded-lg bg-[#9C6644] px-6 py-3 font-semibold text-white transition hover:bg-[#8A5A3C]"
          >
            Browse appliances
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="motion-fade-up mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">WenAppliances</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#111214]">Checkout</h1>
        <p className="mt-2 text-[#4A5568]">Choose delivery or door pickup, then select how you would like to pay.</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-[#E5E4E0] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-7 flex items-center gap-3 border-b border-[#E5E4E0] pb-4">
            <UserRound className="h-5 w-5 text-[#9C6644]" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-[#111214]">Customer details</h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#111214]">Full name</span>
              <input name="name" value={formData.name} onChange={handleChange} required autoComplete="name" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#111214]">Email</span>
              <input name="email" type="email" value={formData.email} onChange={handleChange} required autoComplete="email" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#111214]"><Phone className="h-4 w-4 text-[#9C6644]" aria-hidden="true" /> Phone number</span>
              <input name="phone" type="tel" value={formData.phone} onChange={handleChange} required autoComplete="tel" className="w-full rounded-lg border border-[#E5E4E0] px-3 py-2.5 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
            </label>

            <fieldset className="sm:col-span-2">
              <legend className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#111214]"><MapPin className="h-4 w-4 text-[#9C6644]" aria-hidden="true" /> Fulfillment option</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {FULFILLMENT_METHODS.map((method) => (
                  <label key={method.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${formData.fulfillmentMethod === method.value ? 'border-[#9C6644] bg-[#9C6644]/5' : 'border-[#E5E4E0] hover:bg-[#F4F3EF]'}`}>
                    <input type="radio" name="fulfillmentMethod" value={method.value} checked={formData.fulfillmentMethod === method.value} onChange={handleChange} required={method.value === 'DELIVERY'} className="mt-1 h-4 w-4 accent-[#9C6644]" />
                    <span>
                      <span className="block text-sm font-semibold text-[#111214]">{method.label}</span>
                      <span className="mt-1 block text-xs text-[#858884]">{method.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {formData.fulfillmentMethod === 'DELIVERY' && (
              <label className="block sm:col-span-2">
                <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#111214]"><MapPin className="h-4 w-4 text-[#9C6644]" aria-hidden="true" /> Delivery address</span>
                <textarea name="address" value={formData.address} onChange={handleChange} required rows={4} autoComplete="street-address" placeholder="Where should we deliver your appliance?" className="w-full resize-y rounded-lg border border-[#E5E4E0] px-3 py-2.5 outline-none transition focus:border-[#9C6644] focus:ring-2 focus:ring-[#9C6644]/20" />
              </label>
            )}

            {formData.fulfillmentMethod === 'DOOR_PICKUP' && (
              <div className="sm:col-span-2 rounded-xl border border-[#9C6644]/30 bg-[#9C6644]/10 p-4 text-sm text-[#4A5568]" role="status">
                <p className="font-semibold text-[#111214]">Arrange your door pickup</p>
                <p className="mt-1">{PICKUP_CONTACT_MESSAGE}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                  <a href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`} className="text-[#9C6644] hover:underline">Call {SUPPORT_PHONE}</a>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#9C6644] hover:underline">Email {SUPPORT_EMAIL}</a>
                </div>
              </div>
            )}
          </div>

          <div className="mb-7 mt-9 flex items-center gap-3 border-b border-[#E5E4E0] pb-4">
            <CreditCard className="h-5 w-5 text-[#9C6644]" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-[#111214]">Payment method</h2>
          </div>

          <div className="space-y-3">
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition ${formData.paymentMethod === method ? 'border-[#9C6644] bg-[#9C6644]/5' : 'border-[#E5E4E0] hover:bg-[#F4F3EF]'}`}>
                <input type="radio" name="paymentMethod" value={method} checked={formData.paymentMethod === method} onChange={handleChange} className="h-4 w-4 accent-[#9C6644]" />
                <span className="text-sm font-semibold text-[#111214]">{method}</span>
              </label>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-2 rounded-lg bg-[#F4F3EF] p-3 text-xs text-[#4A5568]">
            <Lock className="h-4 w-4 shrink-0 text-[#9C6644]" aria-hidden="true" />
            Your order is saved securely to WenAppliances.
          </div>

          <button type="submit" disabled={loading} className="place-order-button mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#111214] px-4 py-3.5 font-bold text-white transition hover:bg-[#24272A] disabled:cursor-not-allowed disabled:opacity-70">
            {loading && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
            {loading ? 'Placing order...' : `Place order · ${formatMoney(cartTotal)}`}
          </button>
        </form>

        <aside className="h-fit rounded-2xl border border-[#E5E4E0] bg-[#F4F3EF] p-6 shadow-sm lg:sticky lg:top-24">
          <h2 className="border-b border-[#E5E4E0] pb-4 text-lg font-bold text-[#111214]">Order summary</h2>
          <div className="max-h-96 space-y-4 overflow-y-auto py-5">
            {cart.map((item) => (
              <div key={getProductId(item)} className="flex gap-3 text-sm">
                {item.image ? <img src={item.image} alt={item.name} className="product-photo h-14 w-14 rounded-lg border border-[#E5E4E0] bg-white object-cover" /> : <div className="h-14 w-14 rounded-lg border border-[#E5E4E0] bg-[#D9D7D1]" />}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-semibold text-[#111214]">{item.name}</p>
                  <p className="mt-1 text-[#858884]">Qty: {item.quantity}</p>
                </div>
                <p className="font-semibold text-[#111214]">{formatMoney(Number(item.price) * Number(item.quantity))}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-[#E5E4E0] pt-4 text-sm">
            <div className="flex justify-between text-[#4A5568]"><span>Subtotal</span><span>{formatMoney(cartTotal)}</span></div>
            <div className="flex justify-between gap-4 text-[#4A5568]"><span>Fulfillment</span><span className="text-right font-semibold text-[#111214]">{formData.fulfillmentMethod === 'DOOR_PICKUP' ? 'Door pickup' : formData.fulfillmentMethod === 'DELIVERY' ? 'Delivery is offered' : 'Choose an option'}</span></div>
            <div className="flex justify-between border-t border-[#E5E4E0] pt-3 text-lg font-bold text-[#111214]"><span>Total</span><span className="text-[#9C6644]">{formatMoney(cartTotal)}</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
