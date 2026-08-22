/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@claude-invoicer/core'],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Our own 2 MB check in parseBriefUpload should be what a user hits, because
    // it can explain itself. Next's default 1 MB cap would reject first with a
    // generic framework error. Headroom above 2 MB so the two never fight.
    serverActions: { bodySizeLimit: '3mb' },
  },
  webpack: (config) => {
    // @claude-invoicer/core uses NodeNext-style ".js" specifiers that point at
    // ".ts" sources; let webpack resolve them.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      ...(config.resolve.extensionAlias ?? {}),
    };
    return config;
  },
};

export default nextConfig;
