const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.auth_token || req.headers['authorization']?.replace('Bearer ', '');

  if (!token) {
    if (req.path.includes('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/admin/login');
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    if (req.path.includes('/api/')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.redirect('/admin/login');
  }

  req.user = decoded;
  next();
}

function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const token = req.headers['authorization']?.replace('Bearer ', '');

  if (apiKey === JWT_SECRET || (token && verifyToken(token))) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized', message: 'Valid API key or token required' });
}

module.exports = {
  generateToken,
  verifyToken,
  authMiddleware,
  apiKeyMiddleware,
  ADMIN_USERNAME,
  ADMIN_PASSWORD
};