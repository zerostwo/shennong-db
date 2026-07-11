import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const directory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: directory });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "src/**", "next-env.d.ts", "eslint.config.mjs", "postcss.config.mjs", "components/catalog-view.tsx", "components/admin-view.tsx", "components/console-view.tsx", "components/auth-view.tsx", "components/admin-section-view.tsx", "vite.config.ts", "index.html"]
  }
];
