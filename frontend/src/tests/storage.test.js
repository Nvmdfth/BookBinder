/**
 * localStorage is not guaranteed to be readable.
 *
 * With site data blocked, in Safari private mode, or inside a partitioned
 * iframe, `localStorage.getItem` throws rather than returning null. Both call
 * sites read it from a useState initializer, so an unguarded throw escapes
 * during render — and one of them is in Layout, which means the entire
 * authenticated shell fails to mount over a remembered sidebar preference.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readSetting, writeSetting } from '../utils/storage';

/** Replace window.localStorage with something that throws, as a locked-down browser does. */
function denyStorage() {
  const denied = {
    getItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    setItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue(denied);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('readSetting', () => {
  it('reads a stored value', () => {
    window.localStorage.setItem('bookbinder_view_mode', 'list');

    expect(readSetting('bookbinder_view_mode', 'grid')).toBe('list');
  });

  it('falls back when the key was never set', () => {
    expect(readSetting('bookbinder_view_mode', 'grid')).toBe('grid');
  });

  it('returns the fallback instead of throwing when storage is denied', () => {
    denyStorage();

    expect(() => readSetting('bookbinder_nav_collapsed', 'grid')).not.toThrow();
    expect(readSetting('bookbinder_nav_collapsed', 'grid')).toBe('grid');
  });

  it('defaults to null when no fallback is given', () => {
    expect(readSetting('never-written')).toBeNull();
  });

  it('preserves a stored empty string rather than treating it as absent', () => {
    window.localStorage.setItem('empty', '');

    expect(readSetting('empty', 'fallback')).toBe('');
  });
});

describe('writeSetting', () => {
  it('persists a value and reports success', () => {
    expect(writeSetting('bookbinder_view_mode', 'list')).toBe(true);
    expect(window.localStorage.getItem('bookbinder_view_mode')).toBe('list');
  });

  it('coerces to string so a boolean round-trips', () => {
    writeSetting('bookbinder_nav_collapsed', true);

    expect(readSetting('bookbinder_nav_collapsed')).toBe('true');
  });

  it('reports failure instead of throwing when storage is denied', () => {
    denyStorage();

    expect(() => writeSetting('bookbinder_nav_collapsed', true)).not.toThrow();
    expect(writeSetting('bookbinder_nav_collapsed', true)).toBe(false);
  });
});
