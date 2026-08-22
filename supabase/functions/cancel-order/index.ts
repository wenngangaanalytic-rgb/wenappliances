import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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
  if (!supabaseUrl || !serviceRoleKey) return respond({ error: 'Order cancellation is not configured.' }, 500);

  try {
    const body = await request.json();
    const email = textValue(body?.email).toLowerCase();
    const orderId = textValue(body?.orderId);

    if (!email || email.length > 254 || !email.includes('@') || !orderId) {
      return respond({ error: 'Please provide the purchase email and order reference.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, customer_email, status, cancellation_reason')
      .eq('id', orderId)
      .eq('customer_email', email)
      .maybeSingle();

    if (orderError) {
      console.error('Order lookup failed:', orderError);
      return respond({ error: 'Unable to find that order right now.' }, 500);
    }

    if (!order) return respond({ error: 'That order could not be found for this email.' }, 404);
    if (String(order.status || '').toLowerCase() !== 'pending') {
      return respond({ error: 'This order can no longer be cancelled because it is already being processed.' }, 409);
    }

    const { data: cancellation, error: cancellationError } = await admin.rpc('cancel_order_atomic', {
      p_order_id: order.id,
      p_customer_email: email,
      p_cancellation_reason: 'Cancelled by customer before confirmation.'
    });

    if (cancellationError) {
      console.error('Order cancellation failed:', cancellationError);
      return respond({ error: cancellationError.message || 'Unable to cancel this order right now.' }, 409);
    }

    return respond({
      orderId: cancellation?.orderId || order.id,
      status: cancellation?.status || 'Cancelled',
      cancellationReason: cancellation?.cancellationReason || 'Cancelled by customer before confirmation.'
    });
  } catch (error) {
    console.error('Order cancellation request failed:', error);
    return respond({ error: 'Unable to cancel this order right now.' }, 400);
  }
});
