const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const FRONTEND_DIR = path.join(__dirname, 'frontend');
const DEMO_USER_EMAIL = 'demo@vo2run.fr';
const DEMO_USER_PASSWORD = 'vo2run2026';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(FRONTEND_DIR));

app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/pro', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pro.html')));
app.get('/pro.html', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pro.html')));

function ensureDemoUser() {
  try {
    let users = [];
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      users = raw ? JSON.parse(raw) : [];
    }

    const exists = users.some(u => u.email && u.email.toLowerCase() === DEMO_USER_EMAIL.toLowerCase());
    if (!exists) {
      users.push({
        id: 'demo-user',
        name: 'Compte de démonstration',
        email: DEMO_USER_EMAIL,
        passwordHash: bcrypt.hashSync(DEMO_USER_PASSWORD, 10),
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
  } catch (err) {
    console.error('ensureDemoUser error', err);
  }
}

ensureDemoUser();

app.post('/api/reservations', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Nom et email requis' });

    const entry = {
      id: Date.now(),
      name,
      email,
      phone: phone || '',
      message: message || '',
      createdAt: new Date().toISOString(),
    };

    let arr = [];
    try {
      if (fs.existsSync(SUBMISSIONS_FILE)) {
        const raw = fs.readFileSync(SUBMISSIONS_FILE, 'utf8');
        arr = raw ? JSON.parse(raw) : [];
      }
    } catch (e) {
      console.error('Lecture submissions impossible', e);
    }

    arr.push(entry);
    try {
      fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(arr, null, 2));
    } catch (e) {
      console.error('Écriture submissions impossible', e);
    }

    // Envoi d'email si configuré
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.NOTIFY_TO) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: process.env.NOTIFY_TO,
          subject: 'Nouvelle demande de réservation — VO2RUN',
          text: `Nom: ${name}\nEmail: ${email}\nTéléphone: ${phone || ''}\nMessage: ${message || ''}`,
        });
      } catch (err) {
        console.error('Erreur envoi mail', err);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Endpoint de création de compte
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email et mot de passe requis' });

    // lire users
    let users = [];
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        users = raw ? JSON.parse(raw) : [];
      }
    } catch (e) {
      console.error('Lecture users impossible', e);
    }

    const exists = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
    if (exists) return res.status(409).json({ error: 'Un compte existe déjà pour cet email' });

    const hash = bcrypt.hashSync(password, 10);
    const user = {
      id: Date.now(),
      name,
      email,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) { console.error('Écriture users impossible', e); }

    // Option: envoyer email de notification comme pour réservations
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.NOTIFY_TO) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: process.env.NOTIFY_TO,
          subject: 'Nouvel enregistrement utilisateur — VO2RUN',
          text: `Nom: ${name}\nEmail: ${email}`,
        });
      } catch (err) { console.error('Erreur envoi mail users', err); }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    let users = [];
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        users = raw ? JSON.parse(raw) : [];
      }
    } catch (e) { console.error('Lecture users impossible', e); }
    const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7*24*60*60*1000 });
    return res.json({ ok: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Erreur serveur' }); }
});

// whoami
function getTokenFromReq(req){
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const pair = cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('token='));
  if (!pair) return null;
  return decodeURIComponent(pair.split('=')[1]);
}

app.get('/api/me', (req, res) => {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ id: payload.id, email: payload.email });
  } catch (err) { return res.status(401).json({ error: 'Not authenticated' }); }
});

// Create Stripe Checkout session (requires auth)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ error: 'Not authenticated' }); }

    const { date, time } = req.body;
    if (!date || !time) return res.status(400).json({ error: 'Date et heure requises' });

    // create booking entry (pending)
    const booking = {
      id: Date.now(),
      userId: payload.id,
      email: payload.email,
      date,
      time,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    let arr = [];
    try {
      if (fs.existsSync(BOOKINGS_FILE)) {
        const raw = fs.readFileSync(BOOKINGS_FILE, 'utf8');
        arr = raw ? JSON.parse(raw) : [];
      }
    } catch (e) { console.error('Lecture bookings impossible', e); }
    arr.push(booking);
    try { fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(arr, null, 2)); } catch (e) { console.error('Écriture bookings impossible', e); }

    // Create Stripe checkout session
    if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
    const amount = process.env.STRIPE_PRICE_CENTS ? Number(process.env.STRIPE_PRICE_CENTS) : 3000;
    const currency = process.env.STRIPE_CURRENCY || 'eur';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: { name: 'Test VO2max' },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/?checkout_success=1`,
      cancel_url: `${req.protocol}://${req.get('host')}/?checkout_cancel=1`,
      customer_email: payload.email,
      metadata: { bookingId: booking.id.toString() },
    });

    return res.json({ url: session.url });
  } catch (err) { console.error('create-checkout-session', err); return res.status(500).json({ error: 'Erreur serveur' }); }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
