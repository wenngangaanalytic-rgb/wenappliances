export const normalizeAdminOrderStatus = (status) => {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('COMPLETE') || normalized.includes('DELIVER') || normalized.includes('PICK')) return 'COMPLETED';
  if (normalized.includes('CONFIRM') || normalized.includes('PROCESS')) return 'CONFIRMED';
  return 'PENDING';
};
