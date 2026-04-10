import pg from 'pg';
const { Pool } = pg;

const gcpDbUrl = process.env.DATABASE_URL;

if (!gcpDbUrl) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

export const pool = new Pool({
  connectionString: gcpDbUrl,
  ssl: { rejectUnauthorized: false }
});
