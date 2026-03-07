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
  
  // Use standard build (standalone requires different start command)
  // output: 'standalone',
};

export default nextConfig;
