import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const directory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: directory });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "src/**", "public/mockServiceWorker.js", "next-env.d.ts", "eslint.config.mjs", "postcss.config.mjs", "vite.config.ts", "index.html"]
  }
];
