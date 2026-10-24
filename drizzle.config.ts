import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./app/lib/backend/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: false,
});
