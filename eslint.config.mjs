import next from "eslint-config-next/core-web-vitals";
const config = [
  ...next,
  {
    ignores: [".next/**", ".next-mock/**", "node_modules/**", ".npm-cache/**"],
  },
];
export default config;
