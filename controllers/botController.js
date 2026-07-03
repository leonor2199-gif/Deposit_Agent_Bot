const Bot = require('../models/Bot');
const Plan = require('../models/Plan');
const PaymentMethod = require('../models/PaymentMethod');
const TelegramGroup = require('../models/TelegramGroup');
const Admin = require('../models/Admin');
const { initBot, stopBot } = require('../services/botService');

// Get all bots (admin-specific)
exports.getBots = async (req, res) => {
  try {
    let query = {};
    
    // If not superadmin, only show their own bots
    if (req.admin.role !== 'superadmin') {
      query.createdBy = req.admin.id;
    }
    
    const bots = await Bot.find(query).sort({ createdAt: -1 });
    
    // Get current admin
    const currentAdmin = await Admin.findById(req.admin.id);
    
    // Get plans - only show plans based on admin's role
    let plans = [];
    if (req.admin.role === 'superadmin') {
      // Superadmin can see all plans
      plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    } else {
      // Regular admin can only see their own plan
      const adminPlan = await Plan.findOne({ name: currentAdmin.plan });
      if (adminPlan) {
        plans = [adminPlan];
      } else {
        // Fallback: get demo plan
        const demoPlan = await Plan.findOne({ name: 'demo' });
        if (demoPlan) plans = [demoPlan];
      }
    }
    
    res.render('bots', { 
      bots, 
      plans,
      adminData: req.admin,
      currentAdmin: currentAdmin,
      isSuperAdmin: req.admin.role === 'superadmin'
    });
  } catch (err) {
    console.error('Error loading bots:', err);
    res.status(500).send('Error loading bot management.');
  }
};

// Get single bot (API)
exports.getBot = async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    
    // Check if admin owns this bot (unless superadmin)
    if (req.admin.role !== 'superadmin' && bot.createdBy.toString() !== req.admin.id) {
      return res.status(403).json({ error: 'You do not have permission to view this bot.' });
    }
    
    res.json(bot);
  } catch (err) {
    console.error('Get bot error:', err);
    res.status(500).json({ error: 'Failed to fetch bot.' });
  }
};

// Create bot
exports.createBot = async (req, res) => {
  try {
    const { 
      name, 
      botToken, 
      description, 
      plan, 
      merchantChatId,
      mainGroupChatId,
      ownerId,
      ownerUsername,
      isActive
    } = req.body;

    // Check if bot token exists
    const existing = await Bot.findOne({ botToken });
    if (existing) {
      return res.status(400).json({ error: 'Bot token already exists.' });
    }

    // Validate required fields
    if (!merchantChatId) {
      return res.status(400).json({ error: 'Merchant Chat ID is required.' });
    }
    if (!mainGroupChatId) {
      return res.status(400).json({ error: 'Main Group Chat ID is required.' });
    }

    // Get current admin
    const currentAdmin = await Admin.findById(req.admin.id);
    if (!currentAdmin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    // Determine the plan for the bot
    let botPlan = plan;
    
    // If not superadmin, force the bot to use the admin's plan
    if (req.admin.role !== 'superadmin') {
      botPlan = currentAdmin.plan; // Use admin's plan
      
      // Check if admin can create more bots
      if (!currentAdmin.isWithinLimits('bots')) {
        return res.status(400).json({ 
          error: `Bot limit reached. Your plan (${currentAdmin.plan}) allows ${currentAdmin.maxBots} bots.` 
        });
      }
    } else {
      // Superadmin can assign any plan, but verify it exists
      if (plan) {
        const planExists = await Plan.findOne({ name: plan });
        if (!planExists) {
          return res.status(400).json({ error: 'Invalid plan selected.' });
        }
        botPlan = plan;
      } else {
        botPlan = 'demo';
      }
    }

    // Get plan limits
    const planLimits = await getPlanLimits(botPlan);
    
    const bot = new Bot({
      name: name || `Bot ${Date.now()}`,
      botToken,
      description: description || '',
      plan: botPlan, // Use the determined plan
      maxMessages: planLimits.maxMessages,
      maxAdmins: planLimits.maxAdmins,
      maxPaymentMethods: planLimits.maxPaymentMethods,
      maxGroups: planLimits.maxGroups,
      merchantChatId: merchantChatId || '',
      mainGroupChatId: mainGroupChatId || '',
      ownerId: ownerId || '',
      ownerUsername: ownerUsername || '',
      createdBy: req.admin.id,
      isActive: isActive !== undefined ? isActive : true,
      features: planLimits.features || {},
      settings: planLimits.settings || {},
      subscriptionExpiry: botPlan === 'lifetime' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await bot.save();

    // Increment bot usage for admin (if not superadmin)
    if (req.admin.role !== 'superadmin') {
      await currentAdmin.incrementUsage('bots');
    }

    // Initialize bot if active
    if (bot.isActive) {
      try {
        await initBot(bot.botToken, bot._id);
        bot.isOnline = true;
        await bot.save();
      } catch (err) {
        console.error('Failed to start bot:', err.message);
      }
    }

    res.json({ success: true, message: 'Bot created successfully.', bot });
  } catch (err) {
    console.error('Create bot error:', err);
    res.status(500).json({ error: 'Failed to create bot: ' + err.message });
  }
};

// Update bot
exports.updateBot = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      plan, 
      isActive,
      merchantChatId,
      mainGroupChatId,
      ownerId,
      ownerUsername,
      features,
      settings
    } = req.body;

    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    
    // Check if admin owns this bot (unless superadmin)
    if (req.admin.role !== 'superadmin' && bot.createdBy.toString() !== req.admin.id) {
      return res.status(403).json({ error: 'You do not have permission to update this bot.' });
    }

    // Get current admin
    const currentAdmin = await Admin.findById(req.admin.id);
    
    // Determine the plan for the bot
    let botPlan = bot.plan; // Keep existing plan by default
    
    // If not superadmin, force the bot to use the admin's plan
    if (req.admin.role !== 'superadmin') {
      botPlan = currentAdmin.plan; // Use admin's plan
    } else {
      // Superadmin can assign any plan
      if (plan) {
        const planExists = await Plan.findOne({ name: plan });
        if (planExists) {
          botPlan = plan;
        }
      }
    }

    // Update fields
    if (name) bot.name = name;
    if (description !== undefined) bot.description = description;
    
    // Only update plan if it changed
    if (botPlan && botPlan !== bot.plan) {
      bot.plan = botPlan;
      const planLimits = await getPlanLimits(botPlan);
      bot.maxMessages = planLimits.maxMessages;
      bot.maxAdmins = planLimits.maxAdmins;
      bot.maxPaymentMethods = planLimits.maxPaymentMethods;
      bot.maxGroups = planLimits.maxGroups;
      bot.features = planLimits.features || {};
      bot.settings = planLimits.settings || {};
    }
    
    if (isActive !== undefined) {
      bot.isActive = isActive;
      if (!isActive) {
        bot.isOnline = false;
        await stopBot(id);
      }
    }
    if (merchantChatId !== undefined) bot.merchantChatId = merchantChatId;
    if (mainGroupChatId !== undefined) bot.mainGroupChatId = mainGroupChatId;
    if (ownerId !== undefined) bot.ownerId = ownerId;
    if (ownerUsername !== undefined) bot.ownerUsername = ownerUsername;
    if (features) bot.features = { ...bot.features, ...features };
    if (settings) bot.settings = { ...bot.settings, ...settings };

    await bot.save();

    // Restart bot if active status changed to true
    if (isActive === true) {
      try {
        await initBot(bot.botToken, bot._id);
        bot.isOnline = true;
        await bot.save();
      } catch (err) {
        console.error('Failed to restart bot:', err.message);
      }
    }

    res.json({ success: true, message: 'Bot updated successfully.', bot });
  } catch (err) {
    console.error('Update bot error:', err);
    res.status(500).json({ error: 'Failed to update bot.' });
  }
};

// Delete bot
exports.deleteBot = async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    
    // Check if admin owns this bot (unless superadmin)
    if (req.admin.role !== 'superadmin' && bot.createdBy.toString() !== req.admin.id) {
      return res.status(403).json({ error: 'You do not have permission to delete this bot.' });
    }

    // Stop bot first
    await stopBot(id);

    // Decrement bot usage for admin (if not superadmin)
    if (req.admin.role !== 'superadmin') {
      const currentAdmin = await Admin.findById(req.admin.id);
      if (currentAdmin && currentAdmin.currentBots > 0) {
        currentAdmin.currentBots -= 1;
        await currentAdmin.save();
      }
    }

    // Clean up associated data
    await PaymentMethod.deleteMany({ botId: id });
    await TelegramGroup.deleteMany({ botId: id });

    await Bot.findByIdAndDelete(id);
    res.json({ success: true, message: 'Bot deleted successfully.' });
  } catch (err) {
    console.error('Delete bot error:', err);
    res.status(500).json({ error: 'Failed to delete bot.' });
  }
};

// Get bot statistics
exports.getBotStats = async (req, res) => {
  try {
    const { id } = req.params;
    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    
    // Check if admin owns this bot (unless superadmin)
    if (req.admin.role !== 'superadmin' && bot.createdBy.toString() !== req.admin.id) {
      return res.status(403).json({ error: 'You do not have permission to view this bot.' });
    }

    const planData = await Plan.findOne({ name: bot.plan });

    const stats = {
      usage: {
        messages: `${bot.currentMessages}/${bot.maxMessages === Infinity ? '∞' : bot.maxMessages}`,
        admins: `${bot.currentAdmins}/${bot.maxAdmins === Infinity ? '∞' : bot.maxAdmins}`,
        paymentMethods: `${bot.currentPaymentMethods}/${bot.maxPaymentMethods === Infinity ? '∞' : bot.maxPaymentMethods}`,
        groups: `${bot.currentGroups}/${bot.maxGroups === Infinity ? '∞' : bot.maxGroups}`
      },
      total: {
        messagesProcessed: bot.totalMessagesProcessed || 0,
        receiptsReceived: bot.totalReceiptsReceived || 0,
        transactions: bot.totalTransactions || 0
      },
      plan: {
        name: bot.plan,
        displayName: planData ? planData.displayName : bot.plan.toUpperCase(),
        price: planData ? planData.price : 0,
        interval: planData ? planData.interval : 'monthly'
      },
      isActive: bot.isActive,
      isOnline: bot.isOnline,
      subscription: bot.subscriptionExpiry ? new Date(bot.subscriptionExpiry).toLocaleDateString() : 'Lifetime',
      features: bot.features || {},
      settings: bot.settings || {},
      merchantChatId: bot.merchantChatId || '未设置',
      mainGroupChatId: bot.mainGroupChatId || '未设置',
      ownerId: bot.ownerId || '未设置',
      ownerUsername: bot.ownerUsername || '未设置'
    };

    res.json(stats);
  } catch (err) {
    console.error('Get bot stats error:', err);
    res.status(500).json({ error: 'Failed to fetch bot stats.' });
  }
};

// Get all available plans (API) - Only for superadmin
exports.getAvailablePlans = async (req, res) => {
  try {
    // Only superadmin can see all plans
    if (req.admin.role !== 'superadmin') {
      const currentAdmin = await Admin.findById(req.admin.id);
      const plan = await Plan.findOne({ name: currentAdmin.plan });
      return res.json(plan ? [plan] : []);
    }
    
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json(plans);
  } catch (err) {
    console.error('Get available plans error:', err);
    res.status(500).json({ error: 'Failed to fetch plans.' });
  }
};

// Helper function to get plan limits
async function getPlanLimits(plan) {
  const planData = await Plan.findOne({ name: plan });
  if (planData) {
    return {
      maxMessages: planData.maxMessages,
      maxAdmins: planData.maxAdmins,
      maxPaymentMethods: planData.maxPaymentMethods,
      maxGroups: planData.maxGroups,
      features: planData.features || {},
      settings: planData.settings || {}
    };
  }
  
  // Fallback to default demo limits
  return {
    maxMessages: 20,
    maxAdmins: 0,
    maxPaymentMethods: 5,
    maxGroups: 1,
    features: {
      qrCodeSupport: true,
      customMessages: false,
      multiLanguage: false,
      analytics: false,
      exportData: false,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false
    },
    settings: {
      autoDeleteMessages: true,
      messageDeleteDelay: 15,
      requirePhoto: true,
      allowCustomAmount: false,
      maxFileSize: 20,
      allowedFileTypes: ['jpg', 'png', 'pdf']
    }
  };
}

// Sync bot plans
exports.syncBotPlans = async (req, res) => {
  try {
    const bots = await Bot.find({});
    let updated = 0;
    let errors = 0;

    for (const bot of bots) {
      try {
        const planData = await Plan.findOne({ name: bot.plan });
        if (planData) {
          bot.maxMessages = planData.maxMessages;
          bot.maxAdmins = planData.maxAdmins;
          bot.maxPaymentMethods = planData.maxPaymentMethods;
          bot.maxGroups = planData.maxGroups;
          bot.features = planData.features || {};
          bot.settings = planData.settings || {};
          await bot.save();
          updated++;
        }
      } catch (err) {
        console.error(`Error syncing bot ${bot._id}:`, err);
        errors++;
      }
    }

    res.json({ 
      success: true, 
      message: `Synced ${updated} bots successfully. ${errors} errors.` 
    });
  } catch (err) {
    console.error('Sync bot plans error:', err);
    res.status(500).json({ error: 'Failed to sync bot plans.' });
  }
};