// render_server/lib/postgres.js
// Neon PostgreSQL Database Helper using official @neondatabase/serverless driver with HTTP fallback

import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

export async function executePostgresQuery(sqlQuery, params = []) {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (!dbUrl) {
    console.warn('[Render Postgres] DATABASE_URL missing.');
    return { success: false, results: [], error: 'DATABASE_URL missing' };
  }

  try {
    const sql = neon(dbUrl);
    // Use sql.query for standard parameter arrays ($1, $2)
    const res = await sql.query(sqlQuery, params);
    return { success: true, results: res.rows || res || [] };
  } catch (driverErr) {
    console.warn('[Render Postgres] Driver execution warning, trying HTTP API fallback:', driverErr.message);

    try {
      const match = dbUrl.match(/@([^/]+)\/([^?]+)/);
      const host = match ? match[1] : null;

      if (!host) {
        return { success: false, error: 'Invalid DATABASE_URL host format' };
      }

      const httpUrl = `https://${host}/sql`;
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': dbUrl
        },
        body: JSON.stringify({ query: sqlQuery, params })
      });

      const text = await response.text();
      if (!response.ok) {
        return { success: false, error: text };
      }

      const data = JSON.parse(text);
      return { success: true, results: data.rows || data.result || [] };
    } catch (httpErr) {
      console.error('[Render Postgres] Both Driver and HTTP fallback failed:', httpErr);
      return { success: false, error: httpErr.message };
    }
  }
}
