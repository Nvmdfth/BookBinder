/**
 * localStorage that cannot take the app down with it.
 *
 * Accessing localStorage *throws* rather than returning null when a browser has
 * site data blocked, in Safari private mode, or inside a partitioned iframe.
 * Both call sites read it from a useState initializer, so an unguarded throw
 * escapes during render — and because one of them is in Layout, that means the
 * whole authenticated shell fails to mount rather than one preference being
 * lost. A remembered UI preference is never worth that.
 */

export function readSetting(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
    return true;
  } catch {
    // Preference simply does not persist this session
    return false;
  }
}
