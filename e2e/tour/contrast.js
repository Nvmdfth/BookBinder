/**
 * Text contrast audit against a live page.
 *
 * frontend/src/tests/themeContrast.test.js checks the palette *tokens*, which
 * is the right place for it and catches most of this. It cannot see a colour
 * applied inline on one element — which is how "Sign Out" ended up at 2.8:1
 * while every token in the stylesheet was compliant. This walks the rendered
 * page instead, so inline styles and computed backgrounds are in scope.
 */

const WCAG_AA = 4.5;

/**
 * Runs in the page. Only leaf elements with their own short text are measured:
 * a container's textContent is the concatenation of its children, so scoring it
 * would attribute one child's colour to all of them.
 */
function collectFailures(threshold) {
  const luminance = (channels) => {
    const [r, g, b] = channels.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

  /* Walks up for the first painted ancestor: a transparent element is sitting
     on whatever is behind it, not on white. */
  const groundOf = (el) => {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !bg.includes('rgba(0, 0, 0, 0)') && bg !== 'transparent') return parse(bg);
      node = node.parentElement;
    }
    return [255, 255, 255];
  };

  const failures = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('p,span,div,h1,h2,h3,h4,label,a,button,small,td,th,li')) {
    const text = el.textContent?.trim();
    if (!text || el.children.length > 0 || text.length > 60) continue;

    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) continue;
    if (el.getBoundingClientRect().width === 0) continue;

    const size = parseFloat(style.fontSize);
    const isLarge = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const min = isLarge ? 3 : threshold;

    const l1 = luminance(parse(style.color));
    const l2 = luminance(groundOf(el));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    if (ratio >= min) continue;

    const key = `${text}|${style.color}`;
    if (seen.has(key)) continue;
    seen.add(key);

    failures.push({
      text: text.slice(0, 50),
      ratio: Math.round(ratio * 100) / 100,
      min,
      fontSize: Math.round(size * 10) / 10,
    });
  }

  return failures;
}

/** Returns every visible text node on the current page below its AA threshold. */
async function auditContrast(page, threshold = WCAG_AA) {
  return page.evaluate(collectFailures, threshold);
}

module.exports = { auditContrast, WCAG_AA };
