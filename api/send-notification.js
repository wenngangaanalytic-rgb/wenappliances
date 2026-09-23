import { timingSafeEqual } from 'node:crypto';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

const MAX_FCM_BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);
const ADMIN_ROLES = ['admin', 'SUPER_ADMIN', 'super_admin'];
const CUSTOMER_ORDER_STATUSES = new Set(['confirmed', 'completed', 'cancelled']);

let firebaseMessaging;
let supabaseAdmin;

const json = (res, status, body) => {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
};

const getHeader = (req, name) => {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const secretsMatch = (received, expected) => {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
};

const getFirebaseMessaging = () => {
  if (firebaseMessaging) return firebaseMessaging;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON.');
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields.');
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  firebaseMessaging = admin.messaging();
  return firebaseMessaging;
};

const getSupabaseAdmin = () => {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Server-side Supabase credentials are not configured.');
  }

  supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return supabaseAdmin;
};

const normalizeRole = (value) => {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'super_admin' || role === 'admin') return 'admin';
  if (role === 'customer') return 'customer';
  return '';
};

const getRecord = (body) => body?.record || body?.new_record || body?.new || body;

const getEventType = (body) => String(body?.type || body?.event || 'INSERT').trim().toUpperCase();

const getTable = (body, record) => {
  const explicitTable = String(body?.table || body?.relation || '').trim().toLowerCase();
  if (explicitTable === 'messages' || explicitTable === 'orders') return explicitTable;
  if (record?.sender_role !== undefined) return 'messages';
  if (record?.customer_email !== undefined && record?.status !== undefined) return 'orders';
  return '';
};

const getChatId = (message) => (
  String(message?.chat_id || `${message?.session_id || ''}::${message?.product_id || ''}`).trim()
);

const getNotificationUrl = (senderRole, message, chatId) => {
  if (senderRole === 'admin') {
    return `/product/${encodeURIComponent(String(message.product_id || ''))}?chat=1`;
  }

  return `/chats?thread=${encodeURIComponent(chatId)}`;
};

const trimText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

const normalizeOrderStatus = (value) => {
  const status = String(value || 'pending').trim().toLowerCase();
  if (status.includes('cancel')) return 'cancelled';
  if (status.includes('complete') || status.includes('deliver') || status.includes('pick')) return 'completed';
  if (status.includes('confirm') || status.includes('process')) return 'confirmed';
  return 'pending';
};

const titleCase = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^\w/, (character) => character.toUpperCase());

const isCustomerCancellation = (order) =>
  String(order?.cancellation_reason || '').trim().toLowerCase().includes('customer');

const toFcmData = (entries) => Object.fromEntries(
  entries.map(([key, value]) => [key, String(value ?? '')])
);

const buildFcmPayload = ({ title, body, data, tag }) => {
  const androidNotification = {
    sound: 'default',
    channelId: 'chat_messages',
    defaultVibrateTimings: true,
    defaultSound: true,
    defaultLightSettings: true,
    notificationPriority: 'PRIORITY_HIGH',
    visibility: 'PUBLIC',
    icon: 'ic_stat_wen',
    color: '#9C6644',
    localOnly: false,
    sticky: false
  };
  if (tag) androidNotification.tag = tag;

  return {
    notification: { title, body },
    data: toFcmData(data),
    android: {
      priority: 'high',
      notification: androidNotification
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
      headers: { 'apns-priority': '10' }
    },
    webpush: {
      notification: {
        icon: '/wen-icon.png',
        badge: '/wen-icon.png',
        vibrate: [200, 100, 200],
        tag: tag || undefined,
        renotify: true
      },
      fcmOptions: { link: '/' }
    }
  };
};

const clearInvalidTokens = async (client, tokens, responses) => {
  const invalidTokens = tokens.filter((token, index) => {
    const errorCode = responses[index]?.error?.code;
    return INVALID_TOKEN_CODES.has(errorCode);
  });

  if (invalidTokens.length === 0) return;

  await client
    .from('members')
    .update({ fcm_token: null })
    .in('fcm_token', invalidTokens);
};

const sendToTokens = async (messaging, client, tokens, message) => {
  let sentCount = 0;
  let failureCount = 0;

  for (let offset = 0; offset < tokens.length; offset += MAX_FCM_BATCH_SIZE) {
    const batch = tokens.slice(offset, offset + MAX_FCM_BATCH_SIZE);
    const result = batch.length === 1
      ? await messaging.send({ ...message, token: batch[0] }).then(() => ({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }]
      })).catch((error) => ({
        successCount: 0,
        failureCount: 1,
        responses: [{ success: false, error }]
      }))
      : await messaging.sendEachForMulticast({ ...message, tokens: batch });

    sentCount += result.successCount || 0;
    failureCount += result.failureCount || 0;
    await clearInvalidTokens(client, batch, result.responses || []);
  }

  return { sentCount, failureCount };
};

const getAdminTokenRows = async (client) => {
  const { data, error } = await client
    .from('members')
    .select('id, fcm_token, role')
    .in('role', ADMIN_ROLES)
    .not('fcm_token', 'is', null);

  if (error) throw error;
  return (data || []).filter((row) => normalizeRole(row.role) === 'admin');
};

const getCustomerTokenRows = async (client, email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];

  const { data, error } = await client
    .from('members')
    .select('id, fcm_token, role')
    .eq('email', normalizedEmail)
    .eq('role', 'customer')
    .not('fcm_token', 'is', null)
    .maybeSingle();

  if (error) throw error;
  return data ? [data] : [];
};

const getCustomerTokenRowsById = async (client, customerId) => {
  const normalizedId = String(customerId || '').trim();
  if (!normalizedId) return [];

  const { data, error } = await client
    .from('members')
    .select('id, fcm_token, role')
    .eq('id', normalizedId)
    .eq('role', 'customer')
    .not('fcm_token', 'is', null)
    .maybeSingle();

  if (error) throw error;
  return data ? [data] : [];
};

const getTokens = (rows) => [...new Set(
  rows.map((row) => String(row?.fcm_token || '').trim()).filter(Boolean)
)];

const routeChatMessage = async (client, message) => {
  if (!message?.id || message?.sender_role === undefined || !message?.content) {
    return { status: 400, body: { error: 'A valid message record is required.' } };
  }

  let senderProfile = null;
  if (message.sender_id) {
    const { data, error } = await client
      .from('members')
      .select('id, role')
      .eq('id', message.sender_id)
      .maybeSingle();

    if (error) throw error;
    senderProfile = data;
  }

  const senderRole = normalizeRole(senderProfile?.role || message.sender_role);
  if (!senderRole) {
    return { status: 200, body: { success: true, ignored: true, reason: 'unknown_sender_role' } };
  }

  const tokenRows = senderRole === 'customer'
    ? await getAdminTokenRows(client)
    : message.customer_id ? await getCustomerTokenRowsById(client, message.customer_id) : [];
  const tokens = getTokens(tokenRows);
  if (tokens.length === 0) {
    return { status: 200, body: { success: true, sent: 0, reason: 'no_registered_devices' } };
  }

  const chatId = getChatId(message);
  const productName = trimText(message.product_name, 120) || 'Product chat';
  const messageText = trimText(message.content, 240) || 'You have a new message.';
  const payload = buildFcmPayload({
    title: senderRole === 'admin' ? 'WenAppliances support' : 'New customer message',
    body: messageText,
    tag: `chat-${message.id}`,
    data: {
      type: 'chat_message',
      messageId: message.id,
      chatId,
      senderId: message.sender_id,
      productId: message.product_id,
      productName,
      senderRole,
      content: messageText,
      url: getNotificationUrl(senderRole, message, chatId)
    }
  });

  const result = await sendToTokens(getFirebaseMessaging(), client, tokens, payload);
  return { status: 200, body: { success: true, event: 'chat_message', sent: result.sentCount, failed: result.failureCount } };
};

const routeOrderChange = async (client, order, oldOrder, eventType) => {
  if (!order?.id) return { status: 400, body: { error: 'A valid order record is required.' } };

  const currentStatus = normalizeOrderStatus(order.status);
  const previousStatus = normalizeOrderStatus(oldOrder?.status);
  if (eventType === 'UPDATE' && (!oldOrder || currentStatus === previousStatus)) {
    return { status: 200, body: { success: true, ignored: true, reason: 'order_status_unchanged' } };
  }

  let tokenRows = [];
  let recipientRole = '';
  let title = '';
  let body = '';
  let url = '/';

  if (eventType === 'INSERT') {
    if (currentStatus !== 'pending') {
      return { status: 200, body: { success: true, ignored: true, reason: 'order_not_pending' } };
    }

    tokenRows = await getAdminTokenRows(client);
    recipientRole = 'admin';
    title = 'New order awaiting confirmation';
    body = `${trimText(order.customer_name, 80) || 'A customer'} placed an order for ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(order.total_amount) || 0)}.`;
    url = '/orders';
  } else if (eventType === 'UPDATE' && currentStatus === 'cancelled' && isCustomerCancellation(order)) {
    tokenRows = await getAdminTokenRows(client);
    recipientRole = 'admin';
    title = 'Order cancelled by customer';
    body = `${trimText(order.customer_name, 80) || 'A customer'} cancelled order ${order.id}.`;
    url = '/orders';
  } else if (eventType === 'UPDATE' && CUSTOMER_ORDER_STATUSES.has(currentStatus)) {
    tokenRows = await getCustomerTokenRows(client, order.customer_email);
    recipientRole = 'customer';
    title = currentStatus === 'confirmed' ? 'Your order is confirmed' : 'Order update from WenAppliances';
    body = currentStatus === 'confirmed'
      ? `Order ${order.id} is confirmed and awaiting ${String(order.fulfillment_method || 'delivery').toLowerCase().replace('_', ' ')}.`
      : `Order ${order.id} is now ${titleCase(currentStatus)}. Open Track Order for the details.`;
    url = `/track-order?order=${encodeURIComponent(String(order.id))}`;
  } else {
    return { status: 200, body: { success: true, ignored: true, reason: 'order_event_not_notifiable' } };
  }

  const tokens = getTokens(tokenRows);
  if (tokens.length === 0) {
    return { status: 200, body: { success: true, event: 'order_update', sent: 0, reason: 'no_registered_devices' } };
  }

  const payload = buildFcmPayload({
    title,
    body,
    tag: `order-${order.id}-${currentStatus}`,
    data: {
      type: 'order_update',
      orderId: order.id,
      status: currentStatus,
      recipientRole,
      url
    }
  });
  const result = await sendToTokens(getFirebaseMessaging(), client, tokens, payload);
  return { status: 200, body: { success: true, event: 'order_update', sent: result.sentCount, failed: result.failureCount } };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed.' });
  }

  const webhookSecret = process.env.NOTIFICATION_WEBHOOK_SECRET || process.env.MESSAGE_WEBHOOK_SECRET;
  if (!secretsMatch(getHeader(req, 'x-webhook-secret'), webhookSecret)) {
    return json(res, 401, { error: 'Unauthorized.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const record = getRecord(body);
    const eventType = getEventType(body);
    const table = getTable(body, record);
    if (!table || !['messages', 'orders'].includes(table)) {
      return json(res, 400, { error: 'A messages or orders database webhook record is required.' });
    }
    if (!['INSERT', 'UPDATE'].includes(eventType)) {
      return json(res, 200, { success: true, ignored: true, reason: 'event_not_supported' });
    }

    const client = getSupabaseAdmin();
    const result = table === 'orders'
      ? await routeOrderChange(client, record, body?.old_record || body?.oldRecord, eventType)
      : eventType === 'INSERT'
        ? await routeChatMessage(client, record)
        : { status: 200, body: { success: true, ignored: true, reason: 'message_updates_not_supported' } };

    return json(res, result.status, result.body);
  } catch (error) {
    console.error('Notification delivery failed:', error?.message || error);
    return json(res, 500, { error: 'Notification delivery is temporarily unavailable.' });
  }
}
