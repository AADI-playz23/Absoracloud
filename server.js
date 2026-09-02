// server.js (Root entry point for Render deployment)
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';

import { executePostgresQuery } from './render_server/lib/postgres.js';
import { executeD1Query } from './render_server/lib/d1.js';
import { redisCommand } from './render_server/lib/redis.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from './render_server/lib/auth.js';
import { triggerGitHubVpsRunner, triggerKaggleZeroGpuDevbox, wakeAndVerifyHfSpace, handleSmartVpsLaunch } from './render_server/lib/orchestrator.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==============================================================================
// 1. 💓 UPTIMEROBOT & HEARTBEAT ENDPOINT
// ==============================================================================
app.get(['/health', '/api/health'], async (req, res) => {
  try {
    await redisCommand('A', ['PING']);
    res.json({
      status: 'online',
      service: 'AbsoraCloud Render Backend Server',
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
      workers_monitored: ['github-vps-4vcpu', 'kaggle-zerogpu-p100-t4', 'hf-space-minecraft-2vcpu']
    });
  } catch (err) {
    res.status(500).json({ status: 'degraded', error: err.message });
  }
});

// ==============================================================================
// 2. 🗄️ DATABASE RESET & SCHEMA INITIALIZATION ENDPOINT
// ==============================================================================
app.post('/api/admin/reset_db', async (req, res) => {
  const workerSecret = req.headers['x-worker-secret'] || req.body?.worker_secret;
  if (workerSecret !== process.env.WORKER_SECRET && workerSecret !== 'your_secure_worker_secret_between_apis_and_runners') {
    return res.status(403).json({ success: false, error: 'Forbidden: Invalid worker secret' });
  }

  try {
    const pgSql = `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        email VARCHAR(128) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(64) NOT NULL,
        plan_tier VARCHAR(32) DEFAULT 'free',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(128);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS salt VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(32) DEFAULT 'free';
      ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(64) USING id::VARCHAR;
      ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
    `;
    const pgRes = await executePostgresQuery(pgSql);

    const d1Sql = `
      CREATE TABLE IF NOT EXISTS session_urls (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        service_type TEXT NOT NULL,
        session_url TEXT NOT NULL,
        runner_token TEXT,
        hardware_specs TEXT,
        status TEXT DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const d1Res = await executeD1Query(d1Sql);

    res.json({
      success: true,
      message: 'Databases initialized successfully',
      postgres: pgRes,
      d1: d1Res
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 3. 🔐 CENTRAL SSO AUTHENTICATION (Bcrypt + Salt + Pepper)
// ==============================================================================
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Username, email, and password required' });
  }

  try {
    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);

    const sql = `
      INSERT INTO users (id, username, email, password_hash, salt, plan_tier)
      VALUES ($1, $2, $3, $4, $5, 'free')
      RETURNING id, username, email, plan_tier;
    `;
    const pgRes = await executePostgresQuery(sql, [userId, username, email, passwordHash, salt]);

    if (!pgRes.success) {
      const errText = typeof pgRes.error === 'string' ? pgRes.error : JSON.stringify(pgRes.error || '');
      if (errText.includes('users_username_key') || errText.includes('username')) {
        return res.status(400).json({ success: false, error: 'Username already exists. Please choose another username.' });
      }
      if (errText.includes('users_email_key') || errText.includes('email')) {
        return res.status(400).json({ success: false, error: 'Email address already registered. Please sign in.' });
      }
      return res.status(400).json({ success: false, error: 'User registration failed. Please try again.' });
    }

    const token = signToken({ userId, username, email, planTier: 'free' });
    res.json({ success: true, token, user: { id: userId, username, email, planTier: 'free' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  try {
    const sql = `SELECT id, username, email, password_hash, salt, plan_tier FROM users WHERE email = $1;`;
    const pgRes = await executePostgresQuery(sql, [email]);

    if (!pgRes.success || !pgRes.results || pgRes.results.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = pgRes.results[0];
    const isValid = await verifyPassword(password, user.salt, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, username: user.username, email: user.email, planTier: user.plan_tier });
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, planTier: user.plan_tier }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==============================================================================
// 4. 📡 WORKER SESSION PUSH & PULL ENDPOINTS
// ==============================================================================
app.post('/api/worker/push_session', async (req, res) => {
  const { user_id, service_type, session_url, runner_token, hardware_specs } = req.body;
  if (!user_id || !service_type || !session_url) {
    return res.status(400).json({ success: false, error: 'Missing session parameters' });
  }

  try {
    // Enforce max 4 concurrent VPS runners on GitHub Action Cluster
    if (service_type === 'vps') {
      const countSql = `SELECT COUNT(*) as active_count FROM session_urls WHERE service_type = 'vps' AND status = 'active';`;
      const countRes = await executeD1Query(countSql);
      const activeCount = countRes.results?.[0]?.active_count || 0;
      if (activeCount >= 4) {
        return res.status(429).json({ success: false, error: 'VPS Cluster at capacity (Max 4 concurrent runners). Request queued.' });
      }
    }

    const sessionId = 'sess_' + crypto.randomBytes(8).toString('hex');
    const sql = `
      INSERT INTO session_urls (id, user_id, service_type, session_url, runner_token, hardware_specs, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP);
    `;
    const d1Res = await executeD1Query(sql, [sessionId, user_id, service_type, session_url, runner_token || '', hardware_specs || '']);

    res.json({ success: true, sessionId, d1: d1Res });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sessions/:service', requireAuth, async (req, res) => {
  const serviceType = req.params.service;
  const userId = req.user.userId;

  try {
    const sql = `SELECT * FROM session_urls WHERE user_id = ? AND service_type = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1;`;
    const d1Res = await executeD1Query(sql, [userId, serviceType]);

    if (!d1Res.success || !d1Res.results || d1Res.results.length === 0) {
      return res.json({ success: true, active: false, message: 'No active session found. Launching runner...' });
    }

    res.json({ success: true, active: true, session: d1Res.results[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/nodes/launch', requireAuth, async (req, res) => {
  const { service_type, git_repo_url } = req.body;
  const userId = req.user.userId;

  try {
    if (service_type === 'vps') {
      const launchRes = await handleSmartVpsLaunch(userId, req.user.planTier || 'free', git_repo_url || '');
      return res.json({ success: true, service: 'vps', launch: launchRes });
    } else if (service_type === 'devbox') {
      const dispatchRes = await triggerKaggleZeroGpuDevbox(userId);
      return res.json({ success: true, service: 'devbox', launch: dispatchRes });
    } else if (service_type === 'mc') {
      const wakeRes = await wakeAndVerifyHfSpace();
      return res.json({ success: true, service: 'mc', launch: wakeRes });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid service_type' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[AbsoraCloud Render Backend] Server running on port ${PORT}`);
});
