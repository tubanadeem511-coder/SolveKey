import "dotenv/config";
import pg from "pg";

export function assertDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl || "")) {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL connection string starting with postgres:// or postgresql://. " +
      "An https://<ref>.supabase.co value is the API URL, not a DB string."
    );
  }
}

let databaseHost = "";
try {
  databaseHost = new URL(process.env.DATABASE_URL || "").hostname;
} catch {
  // assertDatabaseUrl reports malformed or missing URLs during startup.
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseHost === "localhost" || databaseHost === "127.0.0.1"
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (error) => {
  console.error("Unexpected database pool error", error.code, error.message);
});

export const q = (text, params) => pool.query(text, params);
