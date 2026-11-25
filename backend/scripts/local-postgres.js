import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
  throw new Error("Local PostgreSQL helper only accepts a localhost DATABASE_URL.");
}

const user = decodeURIComponent(databaseUrl.username);
const password = decodeURIComponent(databaseUrl.password);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
const port = Number(databaseUrl.port || 5432);
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const databaseDirectory = path.resolve(backendDirectory, ".local", "postgres");

const existingClient = new pg.Client({ connectionString: databaseUrl.toString() });
try {
  await existingClient.connect();
  await existingClient.query("SELECT 1");
  console.log(`Using the existing local PostgreSQL server on port ${port}.`);
  await existingClient.end();
  process.exit(0);
} catch {
  await existingClient.end().catch(() => undefined);
}

await mkdir(path.dirname(databaseDirectory), { recursive: true });
const postgres = new EmbeddedPostgres({
  databaseDir: databaseDirectory,
  user,
  password,
  port,
  persistent: true,
  autoRehydrateSymlinks: true,
});

try {
  await access(path.join(databaseDirectory, "PG_VERSION"));
} catch {
  await postgres.initialise();
}

await postgres.start();

const adminClient = postgres.getPgClient();
await adminClient.connect();
const databaseExists = await adminClient.query(
  "SELECT 1 FROM pg_database WHERE datname=$1",
  [databaseName],
);
await adminClient.end();

if (!databaseExists.rowCount) await postgres.createDatabase(databaseName);
console.log(`Local PostgreSQL is ready on port ${port}; database ${databaseName} is available.`);
