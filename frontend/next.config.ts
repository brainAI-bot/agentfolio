import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Marketplace HTML is backed by mutable SQLite state. Keep an explicit
  // route-level contract so proxies and deploy verification cannot mistake a
  // stale pre-deploy document for the canonical visitor surface.
  async headers() {
    return [
      {
        source: '/marketplace/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
          { key: 'X-AgentFolio-Cache-Policy', value: 'marketplace-no-store-v1' },
        ],
      },
    ];
  },

  // Rewrite API calls to the backend server
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3333';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/openapi.json',
        destination: `${apiUrl}/openapi.json`,
      },
    ];
  },
  
  // Redirects
  async redirects() {
    return [
      {
        source: '/explorer',
        destination: '/satp/explorer',
        permanent: true,
      },
      {
        source: '/docs/api',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/docs/satp',
        destination: '/docs',
        permanent: true,
      },
      {
        source: '/satp/docs',
        destination: '/docs',
        permanent: true,
      },
    ];
  },


  // Optimize images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Tree-shake large packages
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@solana/wallet-adapter-wallets',
      '@solana/wallet-adapter-react',
      '@solana/wallet-adapter-react-ui',
    ],
  },
};

export default nextConfig;
