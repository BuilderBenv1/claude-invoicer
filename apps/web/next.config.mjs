/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle @react-pdf with the app (NOT external) so it shares the same single
  // React instance as the route code. Externalizing it made it resolve its own
  // node_modules React while app elements used Next's compiled React, producing
  // two element symbols and React error #31 in the PDF reconciler.
  transpilePackages: ['@claude-invoicer/core', '@react-pdf/renderer'],
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
