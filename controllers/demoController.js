const DemoUser = require('../models/DemoUser');
const Bot = require('../models/Bot');
const PaymentMethod = require('../models/PaymentMethod');
const Plan = require('../models/Plan');

// Create demo environment
exports.setupDemo = async (req, res) => {
  try {
    // Check if demo already exists
    let demoBot = await Bot.findOne({ name: 'Demo Bot' });
    
    if (!demoBot) {
      // Create demo bot
      const demoPlan = await Plan.findOne({ name: 'pro' });
      demoBot = new Bot({
        name: 'Demo Bot',
        botToken: process.env.DEMO_BOT_TOKEN || 'demo_token_123',
        description: 'Demo environment for testing',
        plan: 'pro',
        maxMessages: 100,
        maxAdmins: 5,
        maxPaymentMethods: 20,
        maxGroups: 5,
        merchantChatId: process.env.DEMO_MERCHANT_CHAT_ID || '123456789',
        mainGroupChatId: process.env.DEMO_MAIN_GROUP_CHAT_ID || '-1001234567890',
        isActive: true,
        features: {
          qrCodeSupport: true,
          customMessages: true,
          multiLanguage: true,
          analytics: true,
          exportData: true
        }
      });
      await demoBot.save();
    }

    // Create demo payment methods
    const demoMethods = [
      {
        name: '🏦 Demo Bank Transfer',
        type: 'bank',
        accountName: 'Demo Business Account',
        accountNumber: '1234-5678-9012-3456',
        bankName: 'Demo Bank',
        instructions: 'This is a demo payment method. In production, you would see real instructions here.',
        isActive: true,
        botId: demoBot._id
      },
      {
        name: '💳 Demo Card Payment',
        type: 'card',
        accountName: 'Demo Merchant',
        accountNumber: '4242-4242-4242-4242',
        bankName: 'Demo Card Services',
        instructions: 'This is a demo card payment. No real charges will be made.',
        isActive: true,
        botId: demoBot._id
      },
      {
        name: '📱 Demo Wallet',
        type: 'wallet',
        accountName: 'Demo Wallet',
        accountNumber: 'demo_wallet_123',
        bankName: 'Demo Wallet Services',
        instructions: 'This is a demo wallet payment. Test the flow without real money.',
        isActive: true,
        botId: demoBot._id
      }
    ];

    for (const methodData of demoMethods) {
      const exists = await PaymentMethod.findOne({ name: methodData.name, botId: demoBot._id });
      if (!exists) {
        const method = new PaymentMethod(methodData);
        await method.save();
      }
    }

    res.json({
      success: true,
      message: 'Demo environment setup complete!',
      bot: {
        id: demoBot._id,
        name: demoBot.name,
        token: demoBot.botToken,
        merchantChatId: demoBot.merchantChatId,
        mainGroupChatId: demoBot.mainGroupChatId
      },
      paymentMethods: demoMethods.length,
      instructions: 'Add this bot to your Telegram group and start testing!'
    });
  } catch (err) {
    console.error('Demo setup error:', err);
    res.status(500).json({ error: 'Failed to setup demo environment' });
  }
};

// Get demo status
exports.getDemoStatus = async (req, res) => {
  try {
    const bot = await Bot.findOne({ name: 'Demo Bot' });
    if (!bot) {
      return res.json({ exists: false, message: 'Demo environment not set up yet' });
    }

    const methods = await PaymentMethod.find({ botId: bot._id, isActive: true });
    res.json({
      exists: true,
      bot: {
        name: bot.name,
        isActive: bot.isActive,
        isOnline: bot.isOnline,
        merchantChatId: bot.merchantChatId,
        mainGroupChatId: bot.mainGroupChatId
      },
      paymentMethods: methods.length,
      totalTransactions: bot.totalTransactions || 0,
      totalMessages: bot.totalMessagesProcessed || 0
    });
  } catch (err) {
    console.error('Demo status error:', err);
    res.status(500).json({ error: 'Failed to get demo status' });
  }
};

// Reset demo environment
exports.resetDemo = async (req, res) => {
  try {
    const bot = await Bot.findOne({ name: 'Demo Bot' });
    if (bot) {
      // Reset bot stats
      bot.currentMessages = 0;
      bot.totalMessagesProcessed = 0;
      bot.totalReceiptsReceived = 0;
      bot.totalTransactions = 0;
      await bot.save();
    }

    res.json({ success: true, message: 'Demo environment reset successfully' });
  } catch (err) {
    console.error('Demo reset error:', err);
    res.status(500).json({ error: 'Failed to reset demo environment' });
  }
};