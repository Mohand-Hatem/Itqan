import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The Prisma CLI runs from packages/database; the shared .env lives at the repo root.
config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env["DATABASE_URL"] },
});
