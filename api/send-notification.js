import { timingSafeEqual } from 'node:crypto';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

const MAX_FCM_BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed.' });
  }

  const webhookSecret = process.env.MESSAGE_WEBHOOK_SECRET;
  if (!secretsMatch(getHeader(req, 'x-webhook-secret'), webhookSecret)) {
    return json(res, 401, { error: 'Unauthorized.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (body.type && body.type !== 'INSERT') return json(res, 200, { success: true, ignored: true });

    const message = getRecord(body);
    if (!message?.id || message?.sender_role === undefined || !message?.content) {
      return json(res, 400, { error: 'A valid message record is required.' });
    }

    const client = getSupabaseAdmin();
    let senderProfile = null;
    if (message.sender_id) {
      const { data, error: senderError } = await client
        .from('members')
        .select('id, role')
        .eq('id', message.sender_id)
        .maybeSingle();

      if (senderError) throw senderError;
      senderProfile = data;
    }

    const senderRole = normalizeRole(senderProfile?.role || message.sender_role);
    if (!senderRole) return json(res, 200, { success: true, ignored: true, reason: 'unknown_sender_role' });

    let tokenRows = [];
    if (senderRole === 'customer') {
      const { data, error } = await client
        .from('members')
        .select('id, fcm_token')
        .eq('role', 'admin')
        .not('fcm_token', 'is', null);
      if (error) throw error;
      tokenRows = data || [];
    } else if (message.customer_id) {
      const { data, error } = await client
        .from('members')
        .select('id, fcm_token')
        .eq('id', message.customer_id)
        .eq('role', 'customer')
        .not('fcm_token', 'is', null)
        .maybeSingle();
      if (error) throw error;
      if (data) tokenRows = [data];
    }

    const tokens = [...new Set(tokenRows.map((row) => String(row.fcm_token || '').trim()).filter(Boolean))];
    if (tokens.length === 0) {
      return json(res, 200, { success: true, sent: 0, reason: 'no_registered_devices' });
    }

    const chatId = getChatId(message);
    const productName = trimText(message.product_name, 120) || 'Product chat';
    const messageText = trimText(message.content, 240) || 'You have a new message.';
    const title = senderRole === 'admin' ? 'WenAppliances support' : 'New customer message';
    const payload = {
      notification: { title, body: messageText },
      data: {
        type: 'chat_message',
        messageId: String(message.id),
        chatId,
        senderId: String(message.sender_id || ''),
        productId: String(message.product_id || ''),
        productName,
        senderRole,
        content: messageText,
        url: getNotificationUrl(senderRole, message, chatId)
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'chat_messages'
        }
      }
    };

    const result = await sendToTokens(getFirebaseMessaging(), client, tokens, payload);
    return json(res, 200, { success: true, sent: result.sentCount, failed: result.failureCount });
  } catch (error) {
    console.error('Notification delivery failed:', error?.message || error);
    return json(res, 500, { error: 'Notification delivery is temporarily unavailable.' });
  }
}
