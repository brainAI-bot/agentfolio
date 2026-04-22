import type { MetadataRoute } from 'next';

const BASE_URL = 'https://agentfolio.bot';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/register`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/marketplace`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/leaderboard`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/satp/explorer`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/how-it-works`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/verify`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/docs`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/stats`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE_URL}/import/github`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ];

  let profilePages: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${API_URL}/api/profiles?limit=1000`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const profiles = Array.isArray(data) ? data : data.profiles || [];
      profilePages = profiles.map((p: any) => ({
        url: `${BASE_URL}/profile/${p.id}`,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
    }
  } catch (e) {
    console.error('[Sitemap] Failed to fetch profiles:', e);
  }

  return [...staticPages, ...profilePages];
}
