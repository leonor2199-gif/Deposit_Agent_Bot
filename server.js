require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const mongoose = require('mongoose');
const os = require('os');
const connectDB = require('./config/db');
const { initAllBots } = require('./services/botService');
const createSuperAdmin = require("./utils/createSuperAdmin");

const app = express();

// Connect Database
connectDB();
await createSuperAdmin();

// Global Request parsing engines
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static file asset routing mapping
app.use(express.static(path.join(__dirname, 'public')));

// Template Rendering Layer Mapping configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Apply Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP.'
});
app.use('/admin', limiter);

// ============ ROUTING ============
app.use('/admin', require('./routes/adminRoutes'));
app.use('/api', require('./routes/methodRoutes'));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    }
  };
  res.status(200).json(health);
});

// ============ API DOCS ============
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'PaymentBot API',
    version: '1.0.0',
    endpoints: {
      public: {
        'GET /api/methods/active': 'Get active payment methods'
      },
      admin: {
        'GET /admin/dashboard': 'Dashboard',
        'GET /admin/bots': 'Manage bots',
        'GET /admin/admins': 'Manage admins',
        'GET /admin/plans': 'Manage plans',
        'GET /admin/transactions': 'View transactions'
      }
    }
  });
});

// ============ LANDING & DOCS ============
app.get('/landing', (req, res) => res.render('landing'));
app.get('/docs', (req, res) => res.render('documentation'));

// ============ ROOT ============
app.get('/', (req, res) => res.redirect('/landing'));

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
  console.error('🚨 Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Landing: http://localhost:${PORT}/landing`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  
  // Initialize bots
  await initAllBots();
});
