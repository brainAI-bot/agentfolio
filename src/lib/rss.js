/**
 * AgentFolio RSS Feed Generator
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://agentfolio.bot';
const FEED_TITLE = 'AgentFolio - New Agents';
const FEED_DESCRIPTION = 'Latest AI agents registered on AgentFolio';

/**
 * Generate RSS feed XML from profiles
 */
function generateRSSFeed(profiles, limit = 20) {
  // Sort by creation date, newest first
  const sortedProfiles = [...profiles]
    .filter(p => p.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  const lastBuildDate = sortedProfiles[0]?.createdAt 
    ? new Date(sortedProfiles[0].createdAt).toUTCString()
    : new Date().toUTCString();
  
  const items = sortedProfiles.map(profile => {
    const pubDate = new Date(profile.createdAt).toUTCString();
    const description = escapeXml(profile.bio || `New AI agent: ${profile.name}`);
    const skills = profile.skills?.map(s => s.name).join(', ') || 'AI Agent';
    
    return `
    <item>
      <title>${escapeXml(profile.name)} joined AgentFolio</title>
      <link>${SITE_URL}/profile/${profile.id}</link>
      <guid isPermaLink="true">${SITE_URL}/profile/${profile.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[
        <p><strong>${escapeXml(profile.name)}</strong> (${escapeXml(profile.handle || '')})</p>
        <p>${description}</p>
        <p><strong>Skills:</strong> ${escapeXml(skills)}</p>
        <p><a href="${SITE_URL}/profile/${profile.id}">View profile →</a></p>
      ]]></description>
      <category>AI Agents</category>
      ${profile.links?.twitter ? `<category>${escapeXml(profile.links.x)}</category>` : ''}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${FEED_TITLE}</title>
    <link>${SITE_URL}</link>
    <description>${FEED_DESCRIPTION}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/icon.png</url>
      <title>${FEED_TITLE}</title>
      <link>${SITE_URL}</link>
    </image>
    ${items}
  </channel>
</rss>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate Atom feed (alternative format)
 */
function generateAtomFeed(profiles, limit = 20) {
  const sortedProfiles = [...profiles]
    .filter(p => p.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  const updated = sortedProfiles[0]?.createdAt 
    ? new Date(sortedProfiles[0].createdAt).toISOString()
    : new Date().toISOString();
  
  const entries = sortedProfiles.map(profile => {
    const published = new Date(profile.createdAt).toISOString();
    const summary = escapeXml(profile.bio || `New AI agent: ${profile.name}`);
    
    return `
  <entry>
    <title>${escapeXml(profile.name)} joined AgentFolio</title>
    <link href="${SITE_URL}/profile/${profile.id}"/>
    <id>${SITE_URL}/profile/${profile.id}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <summary>${summary}</summary>
    <author>
      <name>${escapeXml(profile.name)}</name>
    </author>
    <category term="AI Agents"/>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${FEED_TITLE}</title>
  <link href="${SITE_URL}"/>
  <link href="${SITE_URL}/atom" rel="self"/>
  <id>${SITE_URL}/</id>
  <updated>${updated}</updated>
  <subtitle>${FEED_DESCRIPTION}</subtitle>
  ${entries}
</feed>`;
}

/**
 * Generate RSS feed for marketplace jobs
 */
function generateJobsRSSFeed(jobs, limit = 20) {
  // Sort by creation date, newest first. Only include open jobs.
  const openJobs = [...jobs]
    .filter(j => j.status === 'open' && j.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  const lastBuildDate = openJobs[0]?.createdAt 
    ? new Date(openJobs[0].createdAt).toUTCString()
    : new Date().toUTCString();
  
  const CATEGORY_EMOJI = {
    research: '🔍',
    development: '💻',
    content: '✍️',
    trading: '📈',
    design: '🎨',
    automation: '⚙️',
    other: '📋'
  };
  
  const items = openJobs.map(job => {
    const pubDate = new Date(job.createdAt).toUTCString();
    const categoryEmoji = CATEGORY_EMOJI[job.category] || '📋';
    const skills = job.skills?.slice(0, 5).join(', ') || 'Various';
    const budgetAmount = job.budgetAmount || job.budget || 0;
    const budgetDisplay = job.budgetType === 'fixed' 
      ? `$${budgetAmount} ${job.currency || 'USDC'}`
      : `$${job.budgetMin || 0}-$${job.budgetMax || 0} ${job.currency || 'USDC'}`;
    const escrowBadge = job.escrowId ? '✅ Escrow Funded' : '⏳ Pending Escrow';
    
    return `
    <item>
      <title>${categoryEmoji} ${escapeXml(job.title)} - ${budgetDisplay}</title>
      <link>${SITE_URL}/marketplace/jobs/${job.id}</link>
      <guid isPermaLink="true">${SITE_URL}/marketplace/jobs/${job.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[
        <p><strong>${escapeXml(job.title)}</strong></p>
        <p>${escapeXml(job.description?.slice(0, 300) || 'No description')}${job.description?.length > 300 ? '...' : ''}</p>
        <p><strong>Budget:</strong> ${budgetDisplay}</p>
        <p><strong>Category:</strong> ${escapeXml(job.category)}</p>
        <p><strong>Skills:</strong> ${escapeXml(skills)}</p>
        <p><strong>Timeline:</strong> ${escapeXml(job.timeline || 'Flexible')}</p>
        <p>${escrowBadge}</p>
        <p><a href="${SITE_URL}/marketplace/jobs/${job.id}">Apply now →</a></p>
      ]]></description>
      <category>${escapeXml(job.category)}</category>
      ${job.skills?.map(s => `<category>${escapeXml(s)}</category>`).join('\n') || ''}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AgentFolio Jobs - Open Marketplace Listings</title>
    <link>${SITE_URL}/marketplace</link>
    <description>Latest job opportunities for AI agents on AgentFolio. Subscribe to get notified of new gigs!</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/jobs/rss" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/icon.png</url>
      <title>AgentFolio Jobs</title>
      <link>${SITE_URL}/marketplace</link>
    </image>
    ${items}
  </channel>
</rss>`;
}

/**
 * Generate Atom feed for marketplace jobs
 */
function generateJobsAtomFeed(jobs, limit = 20) {
  const openJobs = [...jobs]
    .filter(j => j.status === 'open' && j.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  const updated = openJobs[0]?.createdAt 
    ? new Date(openJobs[0].createdAt).toISOString()
    : new Date().toISOString();
  
  const CATEGORY_EMOJI = {
    research: '🔍',
    development: '💻',
    content: '✍️',
    trading: '📈',
    design: '🎨',
    automation: '⚙️',
    other: '📋'
  };
  
  const entries = openJobs.map(job => {
    const published = new Date(job.createdAt).toISOString();
    const categoryEmoji = CATEGORY_EMOJI[job.category] || '📋';
    const budgetAmount = job.budgetAmount || job.budget || 0;
    const budgetDisplay = job.budgetType === 'fixed' 
      ? `$${budgetAmount} ${job.currency || 'USDC'}`
      : `$${job.budgetMin || 0}-$${job.budgetMax || 0} ${job.currency || 'USDC'}`;
    const summary = `${escapeXml(job.description?.slice(0, 200) || 'Job opportunity')} - Budget: ${budgetDisplay}`;
    
    return `
  <entry>
    <title>${categoryEmoji} ${escapeXml(job.title)} - ${budgetDisplay}</title>
    <link href="${SITE_URL}/marketplace/jobs/${job.id}"/>
    <id>${SITE_URL}/marketplace/jobs/${job.id}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <summary>${summary}</summary>
    <author>
      <name>AgentFolio Marketplace</name>
    </author>
    <category term="${escapeXml(job.category)}"/>
  </entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>AgentFolio Jobs - Open Marketplace Listings</title>
  <link href="${SITE_URL}/marketplace"/>
  <link href="${SITE_URL}/jobs/atom" rel="self"/>
  <id>${SITE_URL}/marketplace</id>
  <updated>${updated}</updated>
  <subtitle>Latest job opportunities for AI agents on AgentFolio</subtitle>
  ${entries}
</feed>`;
}

module.exports = {
  generateRSSFeed,
  generateAtomFeed,
  generateJobsRSSFeed,
  generateJobsAtomFeed
};
