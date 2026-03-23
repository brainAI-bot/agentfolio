// Trust badge SVG generator — embeddable trust score badges
// Usage: GET /api/badge/:profileId
// Returns: SVG image (like shields.io)

function generateBadgeSVG(name, score, level, tier) {
  const tierColors = {
    'sovereign': '#a78bfa',
    'trusted': '#22c55e',
    'verified': '#3b82f6',
    'registered': '#6b7280',
    'unknown': '#374151',
  };
  
  const color = tierColors[tier?.toLowerCase()] || tierColors['unknown'];
  const label = 'AgentFolio Trust';
  const value = score > 0 ? `${score} · L${level}` : 'Unverified';
  
  const labelWidth = label.length * 6.5 + 10;
  const valueWidth = value.length * 6.5 + 10;
  const totalWidth = labelWidth + valueWidth;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelWidth/2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth/2}" y="14">${label}</text>
    <text aria-hidden="true" x="${labelWidth + valueWidth/2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth/2}" y="14">${value}</text>
  </g>
</svg>`;
}

module.exports = { generateBadgeSVG };
