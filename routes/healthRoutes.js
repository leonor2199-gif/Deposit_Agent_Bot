const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const os = require('os');

// Health check endpoint (public)
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2) + '%'
    },
    cpu: {
      cores: os.cpus().length,
      load: os.loadavg()
    },
    database: {
      status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      name: mongoose.connection.name || 'unknown',
      host: mongoose.connection.host || 'unknown'
    },
    version: process.version,
    platform: process.platform
  };
  
  // Check if database is connected
  if (mongoose.connection.readyState !== 1) {
    health.status = 'degraded';
  }
  
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// Detailed health check (authenticated)
router.get('/detailed', async (req, res) => {
  try {
    // Check authentication manually
    const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.admin = decoded;
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const Bot = require('../models/Bot');
    const Transaction = require('../models/Transaction');
    
    const botCount = await Bot.countDocuments();
    const transactionCount = await Transaction.countDocuments();
    const activeBots = await Bot.countDocuments({ isActive: true });
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      statistics: {
        totalBots: botCount,
        activeBots: activeBots,
        totalTransactions: transactionCount
      },
      memory: {
        used: ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1) + '%'
      },
      database: {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        name: mongoose.connection.name
      }
    });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;