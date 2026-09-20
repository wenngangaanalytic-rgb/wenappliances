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
  const key = `cancel-order:${await sha256Hex(forwardedFor)}`;
  const { data, error } = await admin.rpc('consume_api_rate_limit', {
    p_key: key,
    p_limit: 10,
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
  if (!supabaseUrl || !serviceRoleKey) return respond({ error: 'Order cancellation is not configured.' }, 500, request);

  try {
    const body = await request.json();
    const email = textValue(body?.email).toLowerCase();
    const orderId = textValue(body?.orderId);
    const trackingToken = textValue(body?.trackingToken);

    if (!orderId) {
      return respond({ error: 'Please provide the order reference.' }, 400, request);
    }

    const hasValidToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackingToken);
    const authenticatedEmail = await getAuthenticatedEmail(request, supabaseUrl);
    const isAuthorizedMemberCancellation = Boolean(authenticatedEmail && email && authenticatedEmail === email);

    if (!hasValidToken && !isAuthorizedMemberCancellation) {
      return respond({ error: 'Use the private tracking token from checkout or sign in to cancel your own order.' }, 401, request);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    if (!(await enforceRateLimit(admin, request))) {
      return respond({ error: 'Too many cancellation requests. Please wait a minute and try again.' }, 429, request);
    }

    let orderQuery = admin
      .from('orders')
      .select('id, customer_email, status, cancellation_reason, tracking_token_hash')
      .eq('id', orderId);

    orderQuery = hasValidToken
      ? orderQuery.eq('tracking_token_hash', await sha256Hex(trackingToken))
      : orderQuery.eq('customer_email', authenticatedEmail);

    const { data: order, error: orderError } = await orderQuery.maybeSingle();

    if (orderError) {
      console.error('Order lookup failed:', orderError);
      return respond({ error: 'Unable to find that order right now.' }, 500, request);
    }

    if (!order) return respond({ error: 'That order could not be found for this tracking request.' }, 404, request);
    if (String(order.status || '').toLowerCase() !== 'pending') {
      return respond({ error: 'This order can no longer be cancelled because it is already being processed.' }, 409, request);
    }

    const { data: cancellation, error: cancellationError } = await admin.rpc('cancel_order_atomic', {
      p_order_id: order.id,
      p_customer_email: order.customer_email,
      p_cancellation_reason: 'Cancelled by customer before confirmation.'
    });

    if (cancellationError) {
      console.error('Order cancellation failed:', cancellationError);
      return respond({ error: cancellationError.message || 'Unable to cancel this order right now.' }, 409, request);
    }

    return respond({
      orderId: cancellation?.orderId || order.id,
      status: cancellation?.status || 'Cancelled',
      cancellationReason: cancellation?.cancellationReason || 'Cancelled by customer before confirmation.'
    }, 200, request);
  } catch (error) {
    console.error('Order cancellation request failed:', error);
    return respond({ error: 'Unable to cancel this order right now.' }, 400, request);
  }
});
