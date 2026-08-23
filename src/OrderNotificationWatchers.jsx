import { useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import {
  getTrackedOrders,
  showOrderNotification
} from './browserNotifications';

const normalizeStatus = (status) => String(status || 'Pending').trim().toLowerCase();

const formatMoney = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(Number(amount) || 0);

export function AdminOrderNotificationWatcher({ user }) {
  const isAuthorized = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!isAuthorized) return undefined;

    let active = true;
    const seenOrderIds = new Set();

    const announce = (order) => {
      const status = normalizeStatus(order?.status);
      if (!order?.id || !['pending', 'awaiting confirmation'].includes(status)) return;

      void showOrderNotification({
        title: 'New order awaiting confirmation',
        body: `${order.customer_name || 'A customer'} placed an order for ${formatMoney(order.total_amount)}.`,
        tag: `admin-order-${order.id}`,
        url: '/orders',
        icon: '/admin-wen-logo.svg'
      });
    };

    const checkForNewOrders = async (initial = false) => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_name, total_amount, status, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!active || error) return;

      (data || []).forEach((order) => {
        if (seenOrderIds.has(order.id)) return;
        seenOrderIds.add(order.id);
        if (!initial) announce(order);
      });
    };

    void checkForNewOrders(true);

    const ordersChannel = supabase
      .channel(`admin-order-notifications-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        if (!active || seenOrderIds.has(payload.new?.id)) return;
        seenOrderIds.add(payload.new?.id);
        announce(payload.new);
      })
      .subscribe();

    const refreshTimer = window.setInterval(() => checkForNewOrders(false), 10000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(ordersChannel);
    };
  }, [isAuthorized]);

  return null;
}

export function CustomerOrderNotificationWatcher({ user, refreshKey = '' }) {
  const statusByOrderId = useRef(new Map());
  const initialized = useRef(false);

  useEffect(() => {
    let active = true;
    const trackedOrders = getTrackedOrders();
    const trackedOrderIds = new Set(trackedOrders.map((order) => order.id));
    const emails = [...new Set([
      ...trackedOrders.map((order) => order.email),
      user?.email?.trim().toLowerCase()
    ].filter(Boolean))];

    if (emails.length === 0 || trackedOrderIds.size === 0) {
      statusByOrderId.current = new Map();
      initialized.current = false;
      return undefined;
    }

    const checkOrderStatuses = async () => {
      for (const email of emails) {
        const { data, error } = await supabase.functions.invoke('track-order', { body: { email } });
        if (!active || error || !Array.isArray(data?.orders)) continue;

        data.orders
          .filter((order) => trackedOrderIds.has(String(order.id)))
          .forEach((order) => {
            const orderId = String(order.id);
            const currentStatus = normalizeStatus(order.status);
            const previousStatus = statusByOrderId.current.get(orderId);

            if (initialized.current && previousStatus !== currentStatus && currentStatus === 'confirmed') {
              const fulfillment = order.fulfillmentMethod === 'DOOR_PICKUP' ? 'door pickup' : 'delivery';
              void showOrderNotification({
                title: 'Your order is confirmed',
                body: `Order ${orderId} is confirmed and awaiting ${fulfillment}.`,
                tag: `customer-order-${orderId}`,
                url: '/track-order',
                icon: '/wenappliances-logo.svg'
              });
            }

            if (initialized.current && previousStatus !== currentStatus && currentStatus === 'cancelled') {
              void showOrderNotification({
                title: 'Order update from WenAppliances',
                body: `Order ${orderId} has been cancelled. Open Track Order for the details.`,
                tag: `customer-order-${orderId}`,
                url: '/track-order',
                icon: '/wenappliances-logo.svg'
              });
            }

            statusByOrderId.current.set(orderId, currentStatus);
          });
      }

      initialized.current = true;
    };

    void checkOrderStatuses();
    const refreshTimer = window.setInterval(checkOrderStatuses, 8000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [refreshKey, user?.email]);

  return null;
}
