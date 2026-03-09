/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      'dockerode',
      'ssh2',
      'playwright',
      'playwright-core',
      '@playwright/browser-chromium',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't bundle native modules — let Node.js require() handle them at runtime
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'dockerode',
        'ssh2',
        ({ request }, callback) => {
          if (/\.node$/.test(request)) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    }
    // Prevent webpack from trying to parse .node binary files
    config.module.rules.push({
      test: /\.node$/,
      use: 'node-loader',
    })
    return config
  },
}
module.exports = nextConfig
