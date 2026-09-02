// render_server/lib/redis.js
// Upstash Redis Connector (Redis A: Token Cache & Rate-Limiting, Redis B: VPS PTY Terminal Stream Buffer)

const REDIS_A_URL = process.env.UPSTASH_REDIS_A_URL || process.env.KV_REST_API_URL;
const REDIS_A_TOKEN = process.env.UPSTASH_REDIS_A_TOKEN || process.env.KV_REST_API_TOKEN;

const REDIS_B_URL = process.env.UPSTASH_REDIS_B_URL || process.env.UPSTASH_URL;
const REDIS_B_TOKEN = process.env.UPSTASH_REDIS_B_TOKEN || process.env.UPSTASH_TOKEN;

export async function redisCommand(instance = 'A', command = []) {
  const url = instance === 'A' ? REDIS_A_URL : REDIS_B_URL;
  const token = instance === 'A' ? REDIS_A_TOKEN : REDIS_B_TOKEN;

  if (!url || !token) {
    return { success: false, error: `Redis ${instance} configuration missing` };
  }

  try {
    const res = await fetch(`${url}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });

    const data = await res.json();
    return { success: true, result: data.result };
  } catch (err) {
    console.error(`[Render Redis ${instance}] Command error:`, err);
    return { success: false, error: err.message };
  }
}
