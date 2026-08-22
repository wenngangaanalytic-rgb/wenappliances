import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const PAYMENT_METHODS = new Set([
  'Credit / Debit Card (Stripe)',
  'Venmo',
  'Cash App',
  'Cash on Delivery'
]);

const FULFILLMENT_METHODS = new Set(['DELIVERY', 'DOOR_PICKUP']);

const respond = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
);

const textValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const getServerKey = () => {
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyServiceKey) return legacyServiceKey;

  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secretKeysJson) return '';

  try {
    const secretKeys = JSON.parse(secretKeysJson);
    return String(secretKeys.default || Object.values(secretKeys)[0] || '');
  } catch {
    return '';
  }
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = getServerKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: 'Secure checkout is not configured.' }, 500);
  }

  try {
    const body = await request.json();
    const customer = body?.customer ?? {};
    const paymentMethod = textValue(body?.paymentMethod);
    const fulfillmentMethod = textValue(body?.fulfillmentMethod).toUpperCase();
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return respond({ error: 'Please select a supported payment method.' }, 400);
    }

    if (!FULFILLMENT_METHODS.has(fulfillmentMethod)) {
      return respond({ error: 'Please choose delivery or door pickup.' }, 400);
    }

    if (rawItems.length === 0 || rawItems.length > 50) {
      return respond({ error: 'Your cart is empty or contains too many products.' }, 400);
    }

    const items = rawItems.map((item: { productId?: unknown; quantity?: unknown }) => ({
      product_id: textValue(item?.productId),
      quantity: Number(item?.quantity)
    }));

    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
      return respond({ error: 'One or more cart quantities are invalid.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await admin.rpc('create_order_atomic', {
      order_payload: {
        customer_name: textValue(customer?.name),
        customer_email: textValue(customer?.email),
        customer_phone: textValue(customer?.phone),
        delivery_address: textValue(customer?.address),
        fulfillment_method: fulfillmentMethod,
        payment_method: paymentMethod
      },
      items_payload: items
    });

    if (error) {
      console.error('create_order_atomic failed:', error);
      const isValidationError = error.code === 'P0001';
      return respond({ error: isValidationError ? error.message : 'Unable to place the order right now.' }, isValidationError ? 400 : 500);
    }

    return respond({ orderId: data?.orderId, totalAmount: Number(data?.totalAmount || 0) });
  } catch (error) {
    console.error('create-order request failed:', error);
    return respond({ error: 'Unable to place the order right now.' }, 400);
  }
});
