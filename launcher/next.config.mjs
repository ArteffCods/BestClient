/** @type {import('next').NextConfig} */
const nextConfig = {
  // The renderer is shipped as plain static files and served to Electron through the
  // custom `app://` protocol, so no Node server is needed at runtime.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
