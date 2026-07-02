/** @type {import("next").NextConfig} */
const apiTarget = (process.env.API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '')

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
