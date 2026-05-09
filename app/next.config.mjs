/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@coral-xyz/anchor', '@solana/web3.js', '@solana/spl-token'],

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: 'www.google.com' },
    ],
  },

  // Silence the "webpack config but no turbopack config" warning in Next.js 16
  turbopack: {},

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        net: false,
        tls: false,
        child_process: false,
        'pino-pretty': false,
        encoding: false,
      };
    }
    return config;
  },
};

export default nextConfig;
