/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.LOCAL_MOCK_SERVER === "true" ? ".next-mock" : ".next",
};
export default config;
