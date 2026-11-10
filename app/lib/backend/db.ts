import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { backendEnvironmentValid } from "./environment";
import * as schema from "./schema";
let pool: Pool | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function backendConfigured() {
  return backendEnvironmentValid(process.env);
}
export function db() {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_UNAVAILABLE");
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.VERCEL_ENV === "preview"
      ? process.env.APP_DATA_ENV !== "preview"
      : process.env.APP_DATA_ENV !== "production")
  )
    throw new Error("DATABASE_ENVIRONMENT_UNVERIFIED");
  // Neon uses standard PostgreSQL with verified TLS. Only an explicitly local,
  // non-production development database may use an unencrypted connection.
  if (!local && !url.hostname.endsWith(".neon.tech"))
    throw new Error("DATABASE_HOST_UNAPPROVED");
  if (local && process.env.NODE_ENV === "production")
    throw new Error("DATABASE_HOST_UNAPPROVED");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  pool = new Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  database = drizzle(pool, { schema });
  return database;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
  database = null;
}
