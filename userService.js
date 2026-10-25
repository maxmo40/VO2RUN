const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function validateUserInput({ name, email, password }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('Nom requis');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new Error('Email invalide');
  }

  if (!password || String(password).length < 8) {
    throw new Error('Mot de passe trop court (minimum 8 caractères)');
  }

  return {
    name: trimmedName,
    email: normalizedEmail,
    password: String(password),
  };
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Local JSON fallback was removed.');
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
}

async function initUsersTable() {
  const pool = getPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
      ON users (LOWER(email));
    `);
  } finally {
    await pool.end();
  }
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );
    return result.rows[0] || null;
  } finally {
    await pool.end();
  }
}

async function createUser({ name, email, password }) {
  const valid = validateUserInput({ name, email, password });
  const pool = getPool();

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [valid.email]);
    if (exists.rowCount > 0) {
      const error = new Error('Un compte existe déjà pour cet email');
      error.statusCode = 409;
      throw error;
    }

    const passwordHash = bcrypt.hashSync(valid.password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [valid.name, valid.email, passwordHash]
    );

    return result.rows[0];
  } finally {
    await pool.end();
  }
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new Error('Email invalide');
  }

  if (!password || String(password).length < 8) {
    throw new Error('Mot de passe invalide');
  }

  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    const user = result.rows[0];
    if (!user) {
      return null;
    }

    const ok = bcrypt.compareSync(String(password), user.passwordHash);
    if (!ok) {
      return null;
    }

    return { id: user.id, name: user.name, email: user.email };
  } finally {
    await pool.end();
  }
}

async function ensureDemoUser() {
  const demoEmail = 'demo@vo2run.fr';
  const demoPassword = 'vo2run2026';
  const pool = getPool();

  try {
    await initUsersTable();
    const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [demoEmail]);
    if (exists.rowCount === 0) {
      await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
        ['Compte de démonstration', demoEmail, bcrypt.hashSync(demoPassword, 10)]
      );
    }
  } finally {
    await pool.end();
  }
}

module.exports = {
  normalizeEmail,
  validateUserInput,
  createUser,
  loginUser,
  findUserByEmail,
  ensureDemoUser,
  initUsersTable,
};
