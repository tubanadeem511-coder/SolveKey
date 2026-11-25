import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

try {
  await client.connect();
  console.log("Database connection successful");

  const result = await client.query(
    "SELECT current_user, current_database()"
  );

  console.log(result.rows[0]);
} catch (error) {
  console.log("Database connection failed:", error.message);
} finally {
  await client.end().catch(() => {});
}
'@ | Set-Content -Encoding UTF8 ".local\db-test.mjs"