export const ADMIN_PASSKEY_REGISTERED_KEY = 'wenappliances-admin-passkey-registered';

export const hasAdminPasskeyMarker = () => {
  try {
    return window.localStorage.getItem(ADMIN_PASSKEY_REGISTERED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markAdminPasskeyRegistered = () => {
  try {
    window.localStorage.setItem(ADMIN_PASSKEY_REGISTERED_KEY, 'true');
  } catch {
    // Continue if browser storage is unavailable.
  }
};

export const clearAdminPasskeyMarker = () => {
  try {
    window.localStorage.removeItem(ADMIN_PASSKEY_REGISTERED_KEY);
  } catch {
    // Continue if browser storage is unavailable.
  }
};
