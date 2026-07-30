/**
 * Req 4.1.2 — the dark palettes must satisfy WCAG AA (4.5:1) for regular
 * structural typography. This parses the real stylesheet rather than a copy, so
 * a future palette edit that dips below the threshold fails here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.css');
const css = fs.readFileSync(cssPath, 'utf8');

/** Relative luminance per WCAG 2.x. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Extract the custom properties declared in one [data-palette][data-theme] block. */
function readPaletteBlock(palette, theme) {
  const selector = `[data-palette='${palette}'][data-theme='${theme}']`;
  const start = css.indexOf(selector);
  if (start === -1) return null;

  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const PALETTES = ['indigo', 'lavender', 'emerald', 'sunset', 'cyberpunk'];
const AA_NORMAL_TEXT = 4.5;

describe('Dark theme palettes meet WCAG AA (Req 4.1.2)', () => {
  it.each(PALETTES)('%s declares every text and surface token', (palette) => {
    const tokens = readPaletteBlock(palette, 'dark');

    expect(tokens).not.toBeNull();
    for (const token of ['bg-primary', 'bg-secondary', 'text-primary', 'text-secondary', 'text-muted']) {
      expect(tokens[token]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  describe.each(PALETTES)('%s dark palette', (palette) => {
    const tokens = readPaletteBlock(palette, 'dark');

    it.each(['text-primary', 'text-secondary', 'text-muted'])(
      `%s reaches ${AA_NORMAL_TEXT}:1 against both surface colours`,
      (textToken) => {
        const onPrimary = contrastRatio(tokens[textToken], tokens['bg-primary']);
        const onSecondary = contrastRatio(tokens[textToken], tokens['bg-secondary']);

        expect(Math.min(onPrimary, onSecondary)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    );
  });
});

describe('Light theme palettes meet WCAG AA for primary and secondary text', () => {
  // text-muted in light mode is decorative placeholder styling and is not held
  // to the structural-typography bar the PRD sets for the dark palettes.
  describe.each(PALETTES)('%s light palette', (palette) => {
    const tokens = readPaletteBlock(palette, 'light');

    it.each(['text-primary', 'text-secondary'])('%s reaches 4.5:1 on both surfaces', (textToken) => {
      const onPrimary = contrastRatio(tokens[textToken], tokens['bg-primary']);
      const onSecondary = contrastRatio(tokens[textToken], tokens['bg-secondary']);

      expect(Math.min(onPrimary, onSecondary)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  });
});

describe('Dark surface colours follow the PRD guidance', () => {
  it('uses the specified true off-black for the default palette', () => {
    const tokens = readPaletteBlock('indigo', 'dark');

    // Req 4.1.2 names #121212 explicitly to reduce night-time eyestrain
    expect(tokens['bg-primary'].toLowerCase()).toBe('#121212');
  });

  it('keeps every dark palette background genuinely dark', () => {
    for (const palette of PALETTES) {
      const tokens = readPaletteBlock(palette, 'dark');
      expect(luminance(tokens['bg-primary'])).toBeLessThan(0.05);
    }
  });
});

describe('Contrast helper sanity checks', () => {
  it('scores black on white at the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('scores an identical pair at 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});
