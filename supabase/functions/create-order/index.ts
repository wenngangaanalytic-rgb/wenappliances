import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://wenappliances.net',
  'https://www.wenappliances.net',
  'https://wenappliances.vercel.app',
  'http://localhost:5173'
]);

const PAYMENT_METHODS = new Set([
  'Credit / Debit Card (Stripe)',
  'Venmo',
  'Cash App',
  'Cash on Delivery'
]);

const FULFILLMENT_METHODS = new Set(['DELIVERY', 'DOOR_PICKUP']);

const getCorsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };

  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};

const respond = (body: Record<string, unknown>, status: number, request: Request) => new Response(
  JSON.stringify(body),
  { status, headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } }
);

const textValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const enforceRateLimit = async (admin: ReturnType<typeof createClient>, request: Request) => {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `create-order:${await sha256Hex(forwardedFor)}`;
  const { data, error } = await admin.rpc('consume_api_rate_limit', {
    p_key: key,
    p_limit: 5,
    p_window_seconds: 60
  });
  return !error && data === true;
};

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
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405, request);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = getServerKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: 'Secure checkout is not configured.' }, 500, request);
  }

  try {
    const body = await request.json();
    const customer = body?.customer ?? {};
    const paymentMethod = textValue(body?.paymentMethod);
    const fulfillmentMethod = textValue(body?.fulfillmentMethod).toUpperCase();
    const trackingToken = textValue(body?.trackingToken);
    const idempotencyKey = request.headers.get('idempotency-key') ?? '';
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackingToken)) {
      return respond({ error: 'A secure tracking token is required.' }, 400, request);
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return respond({ error: 'A valid idempotency key is required.' }, 400, request);
    }

    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return respond({ error: 'Please select a supported payment method.' }, 400, request);
    }

    if (!FULFILLMENT_METHODS.has(fulfillmentMethod)) {
      return respond({ error: 'Please choose delivery or door pickup.' }, 400, request);
    }

    if (rawItems.length === 0 || rawItems.length > 50) {
      return respond({ error: 'Your cart is empty or contains too many products.' }, 400, request);
    }

    const items = rawItems.map((item: { productId?: unknown; quantity?: unknown }) => ({
      product_id: textValue(item?.productId),
      quantity: Number(item?.quantity)
    }));

    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
      return respond({ error: 'One or more cart quantities are invalid.' }, 400, request);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    if (!(await enforceRateLimit(admin, request))) {
      return respond({ error: 'Too many checkout attempts. Please wait a minute and try again.' }, 429, request);
    }

    const { data, error } = await admin.rpc('create_order_atomic', {
      order_payload: {
        customer_name: textValue(customer?.name),
        customer_email: textValue(customer?.email),
        customer_phone: textValue(customer?.phone),
        delivery_address: textValue(customer?.address),
        fulfillment_method: fulfillmentMethod,
        payment_method: paymentMethod,
        tracking_token_hash: await sha256Hex(trackingToken),
        idempotency_key: idempotencyKey
      },
      items_payload: items
    });

    if (error) {
      console.error('create_order_atomic failed:', error);
      const isValidationError = error.code === 'P0001';
      return respond({ error: isValidationError ? error.message : 'Unable to place the order right now.' }, isValidationError ? 400 : 500, request);
    }

    return respond({ orderId: data?.orderId, totalAmount: Number(data?.totalAmount || 0), trackingToken }, 200, request);
  } catch (error) {
    console.error('create-order request failed:', error);
    return respond({ error: 'Unable to place the order right now.' }, 400, request);
  }
});
