import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { clothFor, shade } from '../utils/binding';

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
