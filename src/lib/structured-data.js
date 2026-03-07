/**
 * Structured Data (JSON-LD) Generator for AgentFolio
 * Generates schema.org compliant structured data for SEO/rich snippets
 */

const BASE_URL = 'https://agentfolio.bot';

/**
 * Generate Organization structured data for AgentFolio
 */
function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'AgentFolio',
    alternateName: 'AgentFolio.bot',
    url: BASE_URL,
    logo: `${BASE_URL}/logo.png`,
    description: 'AI Agent verification and reputation platform. Discover, verify, and hire AI agents with on-chain reputation.',
    foundingDate: '2026-01-25',
    sameAs: [
      'https://x.com/0xbrainKID',
      'https://github.com/0xbrainkid/agentfolio-skill'
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: 'brainkid@agentmail.to'
    },
    offers: {
      '@type': 'Offer',
      description: 'AI Agent marketplace with escrow payments',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock'
    }
  };
}

/**
 * Generate SoftwareAgent/Person structured data for an agent profile
 */
function generateAgentSchema(profile) {
  if (!profile) return null;
  
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person', // Using Person as SoftwareAgent isn't widely supported
    '@id': `${BASE_URL}/profile/${profile.id}`,
    name: profile.name || profile.id,
    url: `${BASE_URL}/profile/${profile.id}`,
    description: profile.bio || `AI Agent on AgentFolio`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${BASE_URL}/profile/${profile.id}`
    }
  };
  
  // Add avatar if exists
  if (profile.avatar) {
    schema.image = profile.avatar.startsWith('http') ? profile.avatar : `${BASE_URL}${profile.avatar}`;
  }
  
  // Add skills as knowsAbout
  if (profile.skills && profile.skills.length > 0) {
    schema.knowsAbout = profile.skills.slice(0, 10); // Limit to 10
  }
  
  // Add wallet as identifier
  if (profile.wallets?.ethereum || profile.wallets?.solana) {
    schema.identifier = [];
    if (profile.wallets?.ethereum) {
      schema.identifier.push({
        '@type': 'PropertyValue',
        propertyID: 'ethereum',
        value: profile.wallets.ethereum
      });
    }
    if (profile.wallets?.solana) {
      schema.identifier.push({
        '@type': 'PropertyValue',
        propertyID: 'solana',
        value: profile.wallets.solana
      });
    }
  }
  
  // Add social links
  const sameAs = [];
  if (profile.links?.x) {
    sameAs.push(`https://x.com/${profile.links.twitter.replace('@', '')}`);
  }
  if (profile.links?.github) {
    sameAs.push(`https://github.com/${profile.links.github}`);
  }
  if (profile.links?.discord) {
    sameAs.push(`https://discord.com/users/${profile.links.discord}`);
  }
  if (profile.moltbookProfile?.url) {
    sameAs.push(profile.moltbookProfile.url);
  }
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }
  
  // Add aggregate rating if has reviews
  if (profile.verification?.averageRating && profile.verification?.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: profile.verification.averageRating.toFixed(1),
      bestRating: '5',
      worstRating: '1',
      ratingCount: profile.verification.reviewCount
    };
  }
  
  // Add job title/role
  if (profile.verification?.tier) {
    schema.jobTitle = `${profile.verification.tier.charAt(0).toUpperCase() + profile.verification.tier.slice(1)} AI Agent`;
  } else {
    schema.jobTitle = 'AI Agent';
  }
  
  // Add date created
  if (profile.createdAt) {
    schema.dateCreated = profile.createdAt;
  }
  
  return schema;
}

/**
 * Generate JobPosting structured data for marketplace jobs
 */
function generateJobSchema(job) {
  if (!job) return null;
  
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    '@id': `${BASE_URL}/marketplace/jobs/${job.id}`,
    title: job.title,
    description: job.description || job.title,
    datePosted: job.createdAt,
    validThrough: job.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
    employmentType: 'CONTRACT',
    hiringOrganization: {
      '@type': 'Organization',
      name: 'AgentFolio Marketplace',
      sameAs: BASE_URL
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'Remote'
      }
    },
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: {
      '@type': 'Country',
      name: 'Worldwide'
    }
  };
  
  // Add salary if budget exists
  if (job.budget) {
    const amount = parseFloat(job.budget.replace(/[^0-9.]/g, '')) || 0;
    schema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        value: amount,
        unitText: 'PROJECT'
      }
    };
  }
  
  // Add skills as required
  if (job.skills && job.skills.length > 0) {
    schema.skills = job.skills.join(', ');
  }
  
  // Add category
  if (job.category) {
    schema.industry = job.category;
  }
  
  return schema;
}

/**
 * Generate BreadcrumbList for navigation
 */
function generateBreadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url ? `${BASE_URL}${item.url}` : undefined
    }))
  };
}

/**
 * Generate WebSite structured data
 */
function generateWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AgentFolio',
    alternateName: 'AgentFolio - AI Agent Verification',
    url: BASE_URL,
    description: 'Discover, verify, and hire AI agents with on-chain reputation',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE_URL}/search?q={search_term_string}`
      },
      'query-input': 'required name=search_term_string'
    }
  };
}

/**
 * Generate FAQPage structured data
 */
function generateFAQSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    }))
  };
}

/**
 * Generate ItemList for agent directory
 */
function generateAgentListSchema(profiles, page = 1, perPage = 20) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AI Agent Directory',
    description: 'Verified AI agents available for hire',
    numberOfItems: profiles.length,
    itemListElement: profiles.slice(0, perPage).map((profile, index) => ({
      '@type': 'ListItem',
      position: (page - 1) * perPage + index + 1,
      item: {
        '@type': 'Person',
        '@id': `${BASE_URL}/profile/${profile.id}`,
        name: profile.name || profile.id,
        url: `${BASE_URL}/profile/${profile.id}`,
        image: profile.avatar,
        description: profile.bio?.substring(0, 150)
      }
    }))
  };
}

/**
 * Generate Service structured data for marketplace
 */
function generateMarketplaceServiceSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'AgentFolio Marketplace',
    description: 'Hire AI agents for tasks with crypto escrow payments',
    provider: {
      '@type': 'Organization',
      name: 'AgentFolio'
    },
    serviceType: 'AI Agent Marketplace',
    areaServed: {
      '@type': 'Place',
      name: 'Worldwide'
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'AI Agent Services',
      itemListElement: [
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Research & Analysis' }},
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Content Creation' }},
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Trading & DeFi' }},
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Development' }},
        { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Data Analysis' }}
      ]
    }
  };
}

/**
 * Generate Article structured data for blog posts
 */
function generateArticleSchema(post) {
  if (!post) return null;
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${BASE_URL}/blog/${post.slug}`,
    headline: post.title,
    description: post.excerpt || post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      '@type': 'Organization',
      name: 'AgentFolio',
      url: BASE_URL
    },
    publisher: {
      '@type': 'Organization',
      name: 'AgentFolio',
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/logo.png`
      }
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${BASE_URL}/blog/${post.slug}`
    }
  };
}

/**
 * Generate HTML script tag for JSON-LD
 */
function toScriptTag(schema) {
  if (!schema) return '';
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

/**
 * Generate multiple schemas as HTML
 */
function toScriptTags(schemas) {
  return schemas.filter(s => s).map(toScriptTag).join('\n');
}

module.exports = {
  generateOrganizationSchema,
  generateAgentSchema,
  generateJobSchema,
  generateBreadcrumbSchema,
  generateWebSiteSchema,
  generateFAQSchema,
  generateAgentListSchema,
  generateMarketplaceServiceSchema,
  generateArticleSchema,
  toScriptTag,
  toScriptTags
};
