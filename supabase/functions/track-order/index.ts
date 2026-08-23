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
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: 'Purchase history is not configured.' }, 500);
  }

  try {
    const body = await request.json();
    const email = textValue(body?.email).toLowerCase();

    if (!email || email.length > 254 || !email.includes('@')) {
      return respond({ error: 'Enter the email address used during checkout.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: orders, error: ordersError } = await admin
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
      .eq('customer_email', email)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('Purchase history lookup failed:', ordersError);
      return respond({ error: 'Unable to load your purchases right now.' }, 500);
    }

    if (!orders || orders.length === 0) {
      return respond({ error: 'No purchases were found for that email.' }, 404);
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
    });
  } catch (error) {
    console.error('Purchase history request failed:', error);
    return respond({ error: 'Unable to load your purchases right now.' }, 400);
  }
});
