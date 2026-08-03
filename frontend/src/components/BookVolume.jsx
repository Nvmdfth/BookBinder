import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

/**
 * A book rendered as a bound volume.
 *
 * Most volumes in a home library have no cover art on file. The previous grid
 * fell back to a grey book glyph, which reads as a broken image rather than as
 * a shelf. Instead every book is *bound*: a cloth colour, the groove where the
 * cloth wraps the board, a rule struck under the head, and the title typeset in
 * the display face. A real cover image drops into the identical 2:3 frame when
 * one exists, so a mixed shelf still reads as a single object.
 *
 * Sizes are driven entirely by the frame — callers set the width and the
 * aspect-ratio does the rest.
 */

/** Bookbinding cloths. Deliberately desaturated: these sit beside paper. */
export const CLOTHS = [
  '#3a4a9f', '#8f3a35', '#2f6b45', '#9a5a17', '#6b3f6e',
  '#3f4a52', '#2c6360', '#8a6a1f', '#4a3f7a', '#7a3f4f',
];

/** Darken a hex colour by a factor, for the board groove. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = clamp((n >> 16) & 255);
  const g = clamp((n >> 8) & 255);
  const b = clamp(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Pick a binding for a book. Deterministic on the identifier so a given volume
 * is always bound the same way — a shelf that reshuffles its colours on every
 * render would look like a rendering fault rather than a library.
 */
export function clothFor(seed) {
  const key = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return CLOTHS[hash % CLOTHS.length];
}

export default function BookVolume({
  title,
  author,
  coverUrl,
  seed,
  isRead = false,
  size = 'md',
  className = '',
  style,
}) {
  // A cover URL that 404s must fall back to the binding, not to a broken image
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(coverUrl) && !imageFailed;

  const cloth = clothFor(seed ?? title);
  const sizeClass = size === 'md' ? '' : ` volume-${size}`;

  return (
    <div
      className={`volume${sizeClass}${className ? ` ${className}` : ''}`}
      style={{ background: showImage ? 'var(--sunk)' : cloth, ...style }}
    >
      {showImage ? (
        <img
          className="volume-img"
          src={coverUrl}
          alt={title ? `Cover of ${title}` : ''}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <>
          <span className="volume-board" style={{ background: shade(cloth, 0.68) }} />
          <span className="volume-rule" />
          <div className="volume-text">
            <span className="volume-title">{title}</span>
            <span style={{ flex: 1 }} />
            {author && <span className="volume-author">{author}</span>}
          </div>
        </>
      )}

      {isRead && (
        <CheckCircle2
          className="volume-read"
          size={size === 'lg' ? 22 : 16}
          aria-hidden="true"
          /* On a cover image the check needs its own ground to stay legible */
          style={showImage ? { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.8))' } : undefined}
        />
      )}
    </div>
  );
}
