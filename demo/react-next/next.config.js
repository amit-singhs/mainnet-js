/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, options) => {
    config.experiments = { ...config.experiments, topLevelAwait: true };

    if (options.isServer) {
      // Configure aliases only for the client-side build
      config.resolve.alias = {
        ...config.resolve.alias,
        events: require.resolve('events/'),
        fs: false, // or another browser-compatible fs
        http: require.resolve('stream-http'),
        https: require.resolve('https-browserify'),
        net: false,
        stream: require.resolve('stream-browserify'),
        tls: false,
        url: require.resolve('url/'),
      };
    }

    return config;
  },
};

module.exports = nextConfig;