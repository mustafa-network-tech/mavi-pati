/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.LOCAL_MOCK_SERVER === "true" ? ".next-mock" : ".next",
  experimental: {
    // Patient photos (max 5 MB, validated in the action) are uploaded through a Server Action.
    serverActions: { bodySizeLimit: "6mb" },
  },
};
export default config;
