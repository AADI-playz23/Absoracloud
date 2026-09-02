// render_server/lib/auth.js
// Authentication Engine with Bcrypt + Salt + Pepper & JWT SSO Tokens

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'absoracloud-fallback-master-development-secret-9988776655';
const PEPPER = process.env.JWT_PEPPER || 'absoracloud-super-secure-pepper-v3';

/**
 * Hash password using bcrypt and secret Pepper.
 */
export async function hashPassword(password, salt) {
  const pepperedPassword = password + PEPPER + salt;
  const hash = await bcrypt.hash(pepperedPassword, 10);
  return hash;
}

/**
 * Verify password against stored hash with secret Pepper.
 */
export async function verifyPassword(password, salt, storedHash) {
  const pepperedPassword = password + PEPPER + salt;
  return await bcrypt.compare(pepperedPassword, storedHash);
}

/**
 * Sign JWT SSO Token.
 */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * Verify JWT SSO Token.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Express Middleware to protect routes.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired token' });
  }

  req.user = user;
  next();
}
