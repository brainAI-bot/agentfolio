import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rewrite API calls to the backend server
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL;
    if (!apiUrl) throw new Error('INTERNAL_API_URL is required for server-side API routing');
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
