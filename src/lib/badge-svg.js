/**
 * Badge SVG Generator - renders a trust badge for any profile.
 * GET /api/badge/:id.svg
 */

const LEVEL_COLORS = {
  0: { bg: '#6B7280', label: 'Unverified' },
  1: { bg: '#3B82F6', label: 'Registered' },
  2: { bg: '#10B981', label: 'Verified' },
  3: { bg: '#8B5CF6', label: 'Established' },
  4: { bg: '#F59E0B', label: 'Trusted' },
  5: { bg: '#EF4444', label: 'Sovereign' },
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateBadgeSVG(name, level, score) {
  const badgeLevel = level === undefined || level === null ? 0 : level;
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const displayName = name || 'Agent';
  const levelStyle = LEVEL_COLORS[badgeLevel] || LEVEL_COLORS[0];
  const nameWidth = Math.max(displayName.length * 7 + 12, 80);
  const scoreText = `L${badgeLevel} · ${safeScore}`;
  const scoreWidth = scoreText.length * 7 + 12;
  const totalWidth = nameWidth + scoreWidth;
  const escapedName = escapeXml(displayName);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapedName}: ${levelStyle.label}">
  <title>${escapedName}: ${levelStyle.label} (Score: ${safeScore})</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-color="#bbb" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${nameWidth}" height="20" fill="#555"/>
    <rect x="${nameWidth}" width="${scoreWidth}" height="20" fill="${levelStyle.bg}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${nameWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapedName}</text>
    <text x="${nameWidth / 2}" y="14">${escapedName}</text>
    <text x="${nameWidth + scoreWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${scoreText}</text>
    <text x="${nameWidth + scoreWidth / 2}" y="14">${scoreText}</text>
  </g>
</svg>`;
}

module.exports = { generateBadgeSVG };
