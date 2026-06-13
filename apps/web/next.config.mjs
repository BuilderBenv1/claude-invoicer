/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@claude-invoicer/core'],
  // @react-pdf/renderer must run as a real Node module, not be bundled.
  serverExternalPackages: ['@react-pdf/renderer'],
  eslint: { ignoreDuringBuilds: true },
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
