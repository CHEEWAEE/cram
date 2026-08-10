const { Pool } = require("pg");

// DATABASE_URL points at Supabase's transaction pooler (port 6543), which is the
// right target for serverless: each invocation borrows a connection for the length
// of a statement rather than holding one open. `max` stays small because every warm
// function instance keeps its own pool, and they all share the project's limit.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10_000,
});

module.exports = { pool };
