const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const USERS_FILE = path.join(__dirname, 'users.json');

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
    return null;
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
}

function isDatabaseConnectionError(error) {
  const message = String(error && (error.message || error));
  const code = error && error.code;
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|connect/i.test(message) || ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code);
}

async function withDatabaseFallback(fallback, operation) {
  if (!process.env.DATABASE_URL) {
    return fallback();
  }

  const pool = getPool();
  if (!pool) {
    return fallback();
  }

  try {
    return await operation(pool);
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      console.warn('Database unavailable, falling back to local JSON store:', error.message || error);
      return fallback();
    }
    throw error;
  } finally {
    try {
      await pool.end();
    } catch (endError) {
      // ignore cleanup errors in fallback scenarios
    }
  }
}

async function initUsersTable() {
  return withDatabaseFallback(async () => {}, async (pool) => {
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
  });
}

function readUsersJson() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('readUsersJson error', error);
    return [];
  }
}

function writeUsersJson(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('writeUsersJson error', error);
  }
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  return withDatabaseFallback(async () => {
    const users = readUsersJson();
    return users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
  }, async (pool) => {
    const result = await pool.query(
      'SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );
    return result.rows[0] || null;
  });
}

async function createUser({ name, email, password }) {
  const valid = validateUserInput({ name, email, password });

  return withDatabaseFallback(async () => {
    const users = readUsersJson();
    const exists = users.some((user) => normalizeEmail(user.email) === valid.email);
    if (exists) {
      const error = new Error('Un compte existe déjà pour cet email');
      error.statusCode = 409;
      throw error;
    }

    const user = {
      id: Date.now(),
      name: valid.name,
      email: valid.email,
      passwordHash: bcrypt.hashSync(valid.password, 10),
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    writeUsersJson(users);
    return { id: user.id, name: user.name, email: user.email };
  }, async (pool) => {
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
  });
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new Error('Email invalide');
  }

  if (!password || String(password).length < 8) {
    throw new Error('Mot de passe invalide');
  }

  return withDatabaseFallback(async () => {
    const users = readUsersJson();
    const user = users.find((item) => normalizeEmail(item.email) === normalizedEmail);
    if (!user) {
      return null;
    }

    const ok = bcrypt.compareSync(String(password), user.passwordHash);
    if (!ok) {
      return null;
    }

    return { id: user.id, name: user.name, email: user.email };
  }, async (pool) => {
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
  });
}

async function ensureDemoUser() {
  const demoEmail = 'demo@vo2run.fr';
  const demoPassword = 'vo2run2026';

  return withDatabaseFallback(async () => {
    const users = readUsersJson();
    const exists = users.some((user) => normalizeEmail(user.email) === demoEmail);
    if (!exists) {
      users.push({
        id: 'demo-user',
        name: 'Compte de démonstration',
        email: demoEmail,
        passwordHash: bcrypt.hashSync(demoPassword, 10),
        createdAt: new Date().toISOString(),
      });
      writeUsersJson(users);
    }
    return;
  }, async (pool) => {
    await initUsersTable();
    const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [demoEmail]);
    if (exists.rowCount === 0) {
      await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
        ['Compte de démonstration', demoEmail, bcrypt.hashSync(demoPassword, 10)]
      );
    }
  });
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
