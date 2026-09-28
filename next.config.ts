import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "sharp", "argon2", "archiver"],
  poweredByHeader: false,
};
export default config;
