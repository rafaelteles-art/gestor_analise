import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const rtId = '691250b7c3f17e8305b9b82a';

// Check the RedTrack campaign info
const camp = await pool.query(
  `SELECT * FROM redtrack_campaign_selections WHERE campaign_id = $1`,
  [rtId]
);
console.log('=== RedTrack campaign ===');
console.log(camp.rows);

// Check how much RT metric data we have
const mets = await pool.query(
  `SELECT MIN(date) AS min_d, MAX(date) AS max_d, COUNT(*) AS n,
          SUM(cost) AS total_cost, SUM(total_revenue) AS total_rev, SUM(total_conversions) AS tot_conv
   FROM redtrack_metrics WHERE campaign_id = $1`,
  [rtId]
);
console.log('\n=== RedTrack metrics summary ===');
console.log(mets.rows);

// A few sample rows
const sample = await pool.query(
  `SELECT date, campaign_name, clicks, conversions, total_conversions, cost, total_revenue, profit, roas
   FROM redtrack_metrics WHERE campaign_id = $1 ORDER BY date DESC LIMIT 10`,
  [rtId]
);
console.log('\n=== Last 10 RT rows ===');
console.table(sample.rows);

await pool.end();
