import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../src/db.js";

const adminInput = z.object({
  email: z.string().email(),
  password: z.string().min(16),
  name: z.string().min(2).max(100).default("SolveKey Admin"),
});

const sampleReports = [
  {
    category: "garbage",
    severity: 3,
    status: "reported",
    description: "[SolveKey seed sample] Demo: uncollected waste near a public road in Karachi.",
    lat: 24.8607,
    lng: 67.0011,
    department: "KMC Sanitation",
  },
  {
    category: "pothole",
    severity: 4,
    status: "in_progress",
    description: "[SolveKey seed sample] Demo: road surface damage requiring inspection in Karachi.",
    lat: 24.9056,
    lng: 67.0822,
    department: "KMC Roads",
  },
  {
    category: "water_leakage",
    severity: 2,
    status: "resolved",
    description: "[SolveKey seed sample] Demo: water leak requiring a maintenance check in Karachi.",
    lat: 24.8138,
    lng: 67.03,
    department: "Karachi Water Board",
  },
];

async function seed() {
  const parsed = adminInput.safeParse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME || "SolveKey Admin",
  });
  if (!parsed.success) {
    throw new Error("Set ADMIN_EMAIL, ADMIN_PASSWORD (at least 16 characters), and optionally ADMIN_NAME before seeding.");
  }

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('SolveKey-seed'))");

    const existing = await client.query(
      "SELECT id,role FROM users WHERE email=$1 FOR UPDATE",
      [parsed.data.email.toLowerCase()],
    );
    let adminId;
    if (existing.rows.length) {
      if (existing.rows[0].role !== "admin") {
        throw new Error("ADMIN_EMAIL already belongs to a non-admin account; choose a dedicated admin email.");
      }
      adminId = existing.rows[0].id;
    } else {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const inserted = await client.query(
        `INSERT INTO users (name,email,password_hash,role)
         VALUES ($1,$2,$3,'admin') RETURNING id`,
        [parsed.data.name, parsed.data.email.toLowerCase(), passwordHash],
      );
      adminId = inserted.rows[0].id;
    }

    for (const report of sampleReports) {
      const existingReport = await client.query(
        "SELECT id FROM reports WHERE user_id=$1 AND description=$2 LIMIT 1",
        [adminId, report.description],
      );
      if (existingReport.rows.length) continue;

      const department = await client.query(
        "SELECT id FROM departments WHERE $1=ANY(categories) ORDER BY id LIMIT 1",
        [report.category],
      );
      if (!department.rows.length) {
        throw new Error(`No seeded department is configured for category ${report.category}. Run the database migration first.`);
      }

      await client.query(
        `INSERT INTO reports
          (user_id,lat,lng,address,category,severity,status,description,department_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          adminId,
          report.lat,
          report.lng,
          "Demo location, Karachi",
          report.category,
          report.severity,
          report.status,
          report.description,
          department.rows[0].id,
        ],
      );
    }

    await client.query("COMMIT");
    transactionOpen = false;
    console.log(`Seed complete for admin ${parsed.data.email}; demo reports are present.`);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error("SolveKey seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
