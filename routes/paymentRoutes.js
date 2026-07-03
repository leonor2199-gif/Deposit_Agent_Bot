const express = require('express');
const router = express.Router();
const stripeService = require('../services/stripeService');
const Plan = require('../models/Plan');
const Bot = require('../models/Bot');
const { auth } = require('../middleware/authMiddleware');

// Create checkout session
router.post('/create-checkout', auth, stripeService.createCheckoutSession);

// Success page
router.get('/success', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    res.render('payment-success', { 
      sessionId,
      message: 'Payment successful! Your plan has been upgraded.'
    });
  } catch (err) {
    res.render('payment-success', { 
      error: 'Payment verification failed. Please contact support.'
    });
  }
});

// Cancel page
router.get('/cancel', (req, res) => {
  res.render('payment-cancel', {
    message: 'Payment was cancelled. You can try again anytime.'
  });
});

// Get available plans (API)
router.get('/plans', auth, async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Get bot's current plan
router.get('/bot-plan/:botId', auth, async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    res.json({
      plan: bot.plan,
      maxMessages: bot.maxMessages,
      maxAdmins: bot.maxAdmins,
      maxPaymentMethods: bot.maxPaymentMethods,
      maxGroups: bot.maxGroups,
      currentMessages: bot.currentMessages,
      currentAdmins: bot.currentAdmins,
      currentPaymentMethods: bot.currentPaymentMethods,
      currentGroups: bot.currentGroups
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bot plan' });
  }
});

module.exports = router;