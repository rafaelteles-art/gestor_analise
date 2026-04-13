import pg from 'pg';
const { Pool } = pg;

const gcpDbUrl = process.env.DATABASE_URL;

if (!gcpDbUrl) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

let pool: InstanceType<typeof Pool>;

try {
  pool = new Pool({
    connectionString: gcpDbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
} catch (err) {
  console.error("Failed to create database pool:", err);
  throw err;
}

export { pool };
