/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for @coral-xyz/anchor and @solana/* packages that reference
  // Node built-ins — Vercel's runtime handles them fine server-side.
  serverExternalPackages: ['@coral-xyz/anchor', '@solana/web3.js', '@solana/spl-token'],

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
