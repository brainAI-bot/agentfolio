function parseArrayish(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function getBio(profile = {}) {
  return String(profile.bio || profile.description || '').trim();
}

function parseObjectish(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function hasAvatarSet(profile = {}) {
  const directAvatar = String(profile.avatar || profile.avatar_url || '').trim();
  if (directAvatar) return true;

  const nftAvatar = parseObjectish(profile.nft_avatar || profile.nftAvatar);
  return Boolean(
    nftAvatar?.image ||
    nftAvatar?.identifier ||
    nftAvatar?.mint ||
    nftAvatar?.mintAddress ||
    nftAvatar?.verifiedOnChain ||
    nftAvatar?.permanent
  );
}

function countPortfolioItems(profile = {}) {
  const direct = profile.portfolioItemsCount ?? profile.portfolio_count ?? profile.projectCount ?? profile.projectsCount;
  if (Number.isFinite(Number(direct))) return Math.max(0, Number(direct));

  for (const key of ['portfolio', 'portfolio_items', 'portfolioItems', 'projects']) {
    const value = profile[key];
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.length;
      } catch (_) {}
    }
  }

  return 0;
}

function summarizeProfileCompleteness(profile = {}) {
  const bio = getBio(profile);
  const skills = parseArrayish(profile.skills);
  const handle = String(profile.handle || '').trim();
  const portfolioCount = countPortfolioItems(profile);

  return {
    bio,
    bioLength: bio.length,
    hasBio: bio.length > 0,
    hasBio50: bio.length >= 50,
    hasAvatar: hasAvatarSet(profile),
    skills,
    skillCount: skills.length,
    hasThreeSkills: skills.length >= 3,
    hasHandle: Boolean(handle),
    portfolioCount,
  };
}

function isProfileCompleteForLevel(profile = {}) {
  const summary = summarizeProfileCompleteness(profile);
  return summary.hasBio && summary.hasAvatar && summary.hasThreeSkills;
}

function computeProfileCompleteness(profile = {}) {
  const summary = summarizeProfileCompleteness(profile);
  const breakdown = {
    bio: summary.hasBio50 ? 5 : 0,
    avatar: summary.hasAvatar ? 5 : 0,
    skills: summary.hasThreeSkills ? 5 : 0,
    handle: summary.hasHandle ? 5 : 0,
    portfolio: Math.min(2, summary.portfolioCount) * 5,
  };

  return {
    total: breakdown.bio + breakdown.avatar + breakdown.skills + breakdown.handle + breakdown.portfolio,
    breakdown,
    summary,
  };
}

module.exports = {
  parseArrayish,
  countPortfolioItems,
  summarizeProfileCompleteness,
  isProfileCompleteForLevel,
  computeProfileCompleteness,
};
