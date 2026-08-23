// These helpers keep the customer and administrator access boundaries
// consistent across both deployments. The email is not a secret; the actual
// authorization decision still comes from Supabase app_metadata.role.
export const SUPER_ADMIN_EMAIL = String(
  import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'wenngangaanalytic@gmail.com'
).trim().toLowerCase();

export const normalizeAuthEmail = (email) => String(email || '').trim().toLowerCase();

export const isSuperAdminUser = (authUser) => (
  String(authUser?.app_metadata?.role || '').trim().toUpperCase() === 'SUPER_ADMIN'
);

export const isReservedSuperAdminEmail = (email) => (
  normalizeAuthEmail(email) === SUPER_ADMIN_EMAIL
);

export const hasStrongCustomerPassword = (password) => (
  typeof password === 'string'
  && password.length >= 6
  && password.length <= 15
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[!@#$%^&*(),.?":{}|<>[\]\\/'`~_+=;-]/.test(password)
);

export const CUSTOMER_PORTAL_ADMIN_MESSAGE = 'This administrator account can only be used in the WenAppliances admin portal.';
export const ADMIN_PORTAL_ROLE_MESSAGE = 'Administrator access is required. Customer accounts cannot sign in here.';
export const STRONG_CUSTOMER_PASSWORD_MESSAGE = 'Use 6–15 characters with uppercase and lowercase letters, a number, and a special character.';
