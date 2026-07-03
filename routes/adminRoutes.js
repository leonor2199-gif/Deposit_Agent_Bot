const express = require('express');
const router = express.Router();

// Import controllers
const adminController = require('../controllers/adminController');
const methodController = require('../controllers/methodController');
const botController = require('../controllers/botController');
const planController = require('../controllers/planController');

// Import models
const Admin = require('../models/Admin');
const Bot = require('../models/Bot');
const TelegramGroup = require('../models/TelegramGroup');
const Transaction = require('../models/Transaction');

// Import middleware
const { auth, isSuperAdmin } = require('../middleware/authMiddleware');
const { initBot, stopBot } = require('../services/botService');

// ============ PUBLIC ROUTES ============
router.get('/login', adminController.getLogin);
router.post('/login', adminController.postLogin);
router.get('/logout', adminController.logout);

// ============ PROTECTED ROUTES ============
// Dashboard
router.get('/dashboard', auth, adminController.getDashboard);

// ============ PERMISSION CHECK ============
router.get('/api/my-permissions', auth, adminController.getMyPermissions);

// ============ PAYMENT METHOD ROUTES ============
router.get('/methods/new', auth, methodController.getCreateForm);
router.post('/methods/new', auth, methodController.createMethod);
router.get('/methods/edit/:id', auth, methodController.getEditForm);
router.post('/methods/edit/:id', auth, methodController.updateMethod);
router.delete('/methods/:id', auth, methodController.deleteMethod);

// ============ ADMIN MANAGEMENT ============
router.get('/admins', auth, isSuperAdmin, adminController.getAdmins);
router.post('/admins', auth, isSuperAdmin, adminController.createAdmin);
router.put('/admins/:id', auth, isSuperAdmin, adminController.updateAdmin);
router.delete('/admins/:id', auth, isSuperAdmin, adminController.deleteAdmin);
router.get('/api/admins/:id', auth, isSuperAdmin, adminController.getAdmin);

// ============ BOT MANAGEMENT ============
router.get('/bots', auth, botController.getBots);
router.post('/bots', auth, botController.createBot);
router.put('/bots/:id', auth, botController.updateBot);
router.delete('/bots/:id', auth, botController.deleteBot);

// API routes for bot
router.get('/api/bots/:id', auth, botController.getBot);
router.get('/api/bots/:id/stats', auth, botController.getBotStats);
router.get('/api/bots/plans/available', auth, botController.getAvailablePlans);

// Bot control routes
router.post('/bots/:id/start', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    await initBot(bot.botToken, bot._id);
    res.json({ success: true, message: 'Bot started successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start bot: ' + err.message });
  }
});

router.post('/bots/:id/stop', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await stopBot(id);
    res.json({ success: true, message: 'Bot stopped successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop bot: ' + err.message });
  }
});

// Sync bot plans - Only superadmin
router.post('/bots/sync-plans', auth, isSuperAdmin, botController.syncBotPlans);

// ============ PLAN MANAGEMENT ============
// Only superadmin can manage plans
router.get('/plans', auth, isSuperAdmin, planController.getPlans);
router.post('/plans', auth, isSuperAdmin, planController.createPlan);
router.put('/plans/:id', auth, isSuperAdmin, planController.updatePlan);
router.delete('/plans/:id', auth, isSuperAdmin, planController.deletePlan);
router.get('/api/plans/:id', auth, isSuperAdmin, planController.getPlan);
router.post('/plans/seed', auth, isSuperAdmin, planController.seedDefaultPlans);
router.get('/plans/comparison', auth, isSuperAdmin, planController.getPlanComparison);

// ============ TRANSACTION ROUTES ============
// Transaction management
router.get('/transactions', auth, async (req, res) => {
  try {
    let query = {};
    if (req.admin.role !== 'superadmin') {
      const bots = await Bot.find({ createdBy: req.admin.id });
      const botIds = bots.map(b => b._id);
      query.botId = { $in: botIds };
    }
    
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .populate('botId', 'name')
      .populate('paymentMethodId', 'name bankName');
    
    const stats = await Transaction.getStats();
    
    res.render('transactions', { 
      transactions, 
      stats,
      admin: req.admin,
      isSuperAdmin: req.admin.role === 'superadmin'
    });
  } catch (err) {
    console.error('Transactions error:', err);
    res.status(500).send('Error loading transactions.');
  }
});

// API: Get transaction details
router.get('/api/transactions/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('botId', 'name')
      .populate('paymentMethodId', 'name bankName accountNumber');
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    const statusMap = { 
      pending: '⏳ Pending', 
      approved: '✅ Approved', 
      rejected: '❌ Rejected', 
      completed: '🎉 Completed', 
      failed: '⚠️ Failed' 
    };
    transaction.getStatusText = function() {
      return statusMap[this.status] || this.status;
    };
    
    res.json(transaction);
  } catch (err) {
    console.error('Get transaction error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

// API: Update transaction status
router.put('/api/transactions/:id', auth, async (req, res) => {
  try {
    const { status, merchantMessage } = req.body;
    const transaction = await Transaction.findById(req.params.id);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    transaction.status = status;
    transaction.merchantMessage = merchantMessage || transaction.merchantMessage;
    transaction.updatedAt = new Date();
    
    if (status === 'approved') transaction.approvedAt = new Date();
    if (status === 'rejected') transaction.rejectedAt = new Date();
    if (status === 'completed') transaction.completedAt = new Date();
    
    await transaction.save();
    res.json({ success: true, message: 'Transaction updated', transaction });
  } catch (err) {
    console.error('Update transaction error:', err);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Export transactions as CSV
router.get('/transactions/export', auth, async (req, res) => {
  try {
    let query = {};
    if (req.admin.role !== 'superadmin') {
      const bots = await Bot.find({ createdBy: req.admin.id });
      const botIds = bots.map(b => b._id);
      query.botId = { $in: botIds };
    }
    
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 });
    
    let csv = 'ID,Customer,Payment Method,Amount,Status,Date\n';
    transactions.forEach(t => {
      csv += `${t._id},${t.customerFirstName || 'Unknown'},${t.paymentMethodName || 'N/A'},${t.amount},${t.status},${new Date(t.createdAt).toLocaleString()}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export transactions error:', err);
    res.status(500).send('Error exporting transactions');
  }
});

// ============ GROUP MANAGEMENT ============
router.get('/groups', auth, adminController.getGroups);
router.post('/groups', auth, adminController.createGroup);
router.put('/groups/:id', auth, adminController.updateGroup);
router.delete('/groups/:id', auth, adminController.deleteGroup);
router.get('/api/groups/:id', auth, adminController.getGroup);

// ============ ERROR HANDLING ============
// 404 handler for API routes
router.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

module.exports = router;