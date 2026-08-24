/**
 * Cover image URL normalisation.
 *
 * Google Books returns `imageLinks.thumbnail` as plain `http://`, and we store
 * whatever the provider gave us. That is invisible in development — a page
 * served from http://localhost may load http images — and silently broken in
 * production, where the app sits behind TLS and every browser blocks an http
 * image on an https page as mixed content. The cover simply never appears, and
 * BookVolume's placeholder makes the failure look like a design choice.
 *
 * The same asset is served over https by both providers, so upgrading the
 * scheme on ingest costs nothing and fixes the render.
 */

/**
 * Return a URL safe to hand to an <img> on an https page, or null.
 *
 * Only the leading scheme is rewritten: an `http://` appearing inside a query
 * string belongs to whoever wrote the URL and is left alone.
 */
function normalizeCoverUrl(url) {
  if (typeof url !== 'string' || url === '') return null;

  return url.replace(/^http:\/\//i, 'https://');
}

module.exports = { normalizeCoverUrl };
