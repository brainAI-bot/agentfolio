import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rewrite API calls to the backend server
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:3333';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
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
    ];
  },

  // Override stale-while-revalidate for profile-data pages
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 's-maxage=30, stale-while-revalidate=60',
          },
        ],
      },
    ];
  },

  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
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
