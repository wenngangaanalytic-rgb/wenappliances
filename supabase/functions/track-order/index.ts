import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://wenappliances.net',
  'https://www.wenappliances.net',
  'https://wenappliances.vercel.app',
  'http://localhost:5173'
]);

const getCorsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const key = `track-order:${await sha256Hex(forwardedFor)}`;
  const { data, error } = await admin.rpc('consume_api_rate_limit', {
    p_key: key,
    p_limit: 30,
    p_window_seconds: 60
  });
  return !error && data === true;
};

const getAuthenticatedEmail = async (request: Request, supabaseUrl: string) => {
  const authorization = request.headers.get('authorization');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!authorization || !anonKey) return '';

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data } = await authClient.auth.getUser();
  return data.user?.email?.trim().toLowerCase() || '';
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
    return respond({ error: 'Purchase history is not configured.' }, 500, request);
  }

  try {
    const body = await request.json();
    const email = textValue(body?.email).toLowerCase();
    const trackingToken = textValue(body?.trackingToken);

    const hasValidToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackingToken);
    const authenticatedEmail = await getAuthenticatedEmail(request, supabaseUrl);
    const isAuthorizedMemberLookup = Boolean(authenticatedEmail && email && authenticatedEmail === email);

    if (!hasValidToken && !isAuthorizedMemberLookup) {
      return respond({ error: 'Use the private tracking token from checkout or sign in to view member purchases.' }, 401, request);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    if (!(await enforceRateLimit(admin, request))) {
      return respond({ error: 'Too many tracking requests. Please wait a minute and try again.' }, 429, request);
    }

    let orders: any[] = [];
    let ordersError: any = null;

    if (hasValidToken) {
      const { data: order, error } = await admin
        .from('orders')
        .select(`
        id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        fulfillment_method,
        total_amount,
        payment_method,
        status,
        cancellation_reason,
        created_at,
        order_items (
          id,
          product_name,
          product_images,
          quantity,
          price_at_time,
          products (name, images)
        )
      `)
        .eq('tracking_token_hash', await sha256Hex(trackingToken))
        .maybeSingle();
      orders = order ? [order] : [];
      ordersError = error;
    } else {
      const result = await admin
        .from('orders')
        .select(`
        id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        fulfillment_method,
        total_amount,
        payment_method,
        status,
        cancellation_reason,
        created_at,
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
        .eq('customer_email', authenticatedEmail)
        .order('created_at', { ascending: false });
      orders = result.data || [];
      ordersError = result.error;
    }

    if (ordersError) {
      console.error('Purchase history lookup failed:', ordersError);
      return respond({ error: 'Unable to load your purchases right now.' }, 500, request);
    }

    if (!orders || orders.length === 0) {
      return respond({ error: 'No purchases were found for that tracking request.' }, 404, request);
    }

    return respond({
      orders: orders.map((order) => ({
        id: order.id,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        deliveryAddress: order.delivery_address,
        fulfillmentMethod: order.fulfillment_method,
        totalAmount: Number(order.total_amount || 0),
        paymentMethod: order.payment_method,
        status: order.status || 'Pending',
        cancellationReason: order.cancellation_reason || '',
        createdAt: order.created_at,
        items: (order.order_items || []).map((item) => ({
          id: item.id,
          name: item.product_name || item.products?.name || 'Appliance',
          images: item.product_images || item.products?.images || [],
          quantity: Number(item.quantity || 0),
          priceAtTime: Number(item.price_at_time || 0)
        }))
      }))
    }, 200, request);
  } catch (error) {
    console.error('Purchase history request failed:', error);
    return respond({ error: 'Unable to load your purchases right now.' }, 400, request);
  }
});
