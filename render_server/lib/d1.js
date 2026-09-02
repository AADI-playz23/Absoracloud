// render_server/lib/d1.js
// Cloudflare D1 SQLite Connector for Active Session URLs & Worker Metadata

import dotenv from 'dotenv';
dotenv.config();

export async function executeD1Query(sql, params = [], dbId) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const targetDbId = dbId || process.env.D1_DB_1_ID || '6cd8abc0-bd93-4df5-83be-d303b96f66f3';

  if (!accountId || !apiToken) {
    console.warn('[Render D1] Cloudflare API credentials missing.');
    return { success: false, results: [], error: 'Missing Cloudflare API credentials' };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${targetDbId}/query`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    const data = await response.json();
    if (!data.success) {
      console.error('[Render D1] Query error:', data.errors);
      return { success: false, results: [], errors: data.errors };
    }

    const firstResult = data.result?.[0];
    return {
      success: true,
      results: firstResult?.results || [],
      meta: firstResult?.meta || {},
    };
  } catch (err) {
    console.error('[Render D1] Fetch exception:', err);
    return { success: false, results: [], error: err.message };
  }
}
