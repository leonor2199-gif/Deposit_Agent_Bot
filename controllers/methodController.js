const PaymentMethod = require('../models/PaymentMethod');
const Bot = require('../models/Bot');

// API - Get Active Methods (Used by Telegram Bot)
exports.getActiveMethods = async (req, res) => {
  try {
    const { botId } = req.query;
    let query = { isActive: true };
    if (botId) {
      query.botId = botId;
    }
    const methods = await PaymentMethod.find(query);
    res.json(methods);
  } catch (err) {
    console.error('Get active methods error:', err);
    res.status(500).json({ error: 'Server error fetching payment methods.' });
  }
};

// API - Global Methods (Admin-specific)
exports.getAllMethods = async (req, res) => {
  try {
    let query = {};
    
    // If not superadmin, only show methods from their bots
    if (req.admin.role !== 'superadmin') {
      // Get all bots created by this admin
      const bots = await Bot.find({ createdBy: req.admin.id });
      const botIds = bots.map(b => b._id);
      query.botId = { $in: botIds };
    }
    
    const methods = await PaymentMethod.find(query)
      .populate('botId', 'name plan')
      .sort({ createdAt: -1 });
    
    if (req.path.startsWith('/api/')) return res.json(methods);
    res.render('dashboard', { methods });
  } catch (err) {
    console.error('Get all methods error:', err);
    res.status(500).send('Server Error');
  }
};

// Get create form with admin's bots only
exports.getCreateForm = async (req, res) => {
  try {
    let query = { isActive: true };
    
    // If not superadmin, only show their own bots
    if (req.admin.role !== 'superadmin') {
      query.createdBy = req.admin.id;
    }
    
    const bots = await Bot.find(query);
    res.render('form', { method: null, bots });
  } catch (err) {
    console.error('Get create form error:', err);
    res.status(500).send('Error loading form.');
  }
};

// Create method with bot association
exports.createMethod = async (req, res) => {
  try {
    console.log('Creating method with data:', req.body);
    
    const { botId, name, type, accountName, accountNumber, clabe, bankName, instructions, qrCode, isActive } = req.body;
    
    // Check if bot exists
    if (!botId) {
      console.log('❌ No botId provided');
      return res.status(400).send('Bot ID is required.');
    }
    
    const bot = await Bot.findById(botId);
    if (!bot) {
      console.log('❌ Bot not found:', botId);
      return res.status(404).send('Bot not found.');
    }
    
    // Check if admin owns this bot (unless superadmin)
    if (req.admin.role !== 'superadmin' && bot.createdBy.toString() !== req.admin.id) {
      console.log('❌ Admin does not own this bot');
      return res.status(403).send('You do not have permission to add methods to this bot.');
    }
    
    // Check plan limit for payment methods
    if (!bot.isWithinLimits('paymentMethods')) {
      console.log('❌ Bot payment method limit reached');
      return res.status(400).send(`Payment method limit reached. Current plan (${bot.plan}) allows ${bot.maxPaymentMethods} payment methods.`);
    }
    
    const method = await PaymentMethod.create({
      name, 
      type, 
      accountName, 
      accountNumber, 
      clabe: clabe || '', 
      bankName, 
      instructions, 
      qrCode: qrCode || '',
      isActive: isActive === 'on' || isActive === true,
      botId: botId,
      createdBy: req.admin.id // Track who created this
    });
    
    console.log('✅ Method created:', method._id);
    
    // Increment bot usage
    await bot.incrementUsage('paymentMethods');
    
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('❌ Create method error details:', err);
    console.error('Stack:', err.stack);
    res.status(400).send('Error creating configuration: ' + err.message);
  }
};

// Get edit form with admin's bots only
exports.getEditForm = async (req, res) => {
  try {
    const method = await PaymentMethod.findById(req.params.id);
    if (!method) {
      console.log('❌ Method not found:', req.params.id);
      return res.redirect('/admin/dashboard');
    }
    
    // Check if admin owns this method's bot (unless superadmin)
    if (req.admin.role !== 'superadmin') {
      const bot = await Bot.findById(method.botId);
      if (!bot || bot.createdBy.toString() !== req.admin.id) {
        console.log('❌ Admin does not own this bot');
        return res.status(403).send('You do not have permission to edit this method.');
      }
    }
    
    let query = { isActive: true };
    if (req.admin.role !== 'superadmin') {
      query.createdBy = req.admin.id;
    }
    const bots = await Bot.find(query);
    
    res.render('form', { method, bots });
  } catch (err) {
    console.error('❌ Get edit form error:', err);
    res.redirect('/admin/dashboard');
  }
};

// Update method
exports.updateMethod = async (req, res) => {
  try {
    console.log('🔄 Updating method with data:', req.body);
    console.log('🔄 Method ID:', req.params.id);
    
    const { botId, name, type, accountName, accountNumber, clabe, bankName, instructions, qrCode, isActive } = req.body;
    
    const method = await PaymentMethod.findById(req.params.id);
    if (!method) {
      console.log('❌ Method not found for update:', req.params.id);
      return res.status(404).send('Method not found.');
    }
    
    // Check if admin owns this method's bot (unless superadmin)
    if (req.admin.role !== 'superadmin') {
      const bot = await Bot.findById(method.botId);
      if (!bot || bot.createdBy.toString() !== req.admin.id) {
        console.log('❌ Admin does not own this bot');
        return res.status(403).send('You do not have permission to edit this method.');
      }
    }
    
    console.log('📋 Current method:', {
      id: method._id,
      name: method.name,
      botId: method.botId,
      isActive: method.isActive
    });
    
    // If botId is changing, update usage counts
    if (botId && method.botId && method.botId.toString() !== botId) {
      // Check if admin owns the new bot
      if (req.admin.role !== 'superadmin') {
        const newBot = await Bot.findById(botId);
        if (!newBot || newBot.createdBy.toString() !== req.admin.id) {
          return res.status(403).send('You do not have permission to use this bot.');
        }
      }
      
      console.log('🔄 Bot ID changing from', method.botId, 'to', botId);
      
      // Decrement old bot
      const oldBot = await Bot.findById(method.botId);
      if (oldBot) {
        if (oldBot.currentPaymentMethods > 0) {
          oldBot.currentPaymentMethods -= 1;
          await oldBot.save();
          console.log('📉 Decremented old bot usage:', oldBot.currentPaymentMethods);
        }
      }
      
      // Increment new bot
      const newBot = await Bot.findById(botId);
      if (newBot) {
        if (!newBot.isWithinLimits('paymentMethods')) {
          return res.status(400).send(`Payment method limit reached. Current plan (${newBot.plan}) allows ${newBot.maxPaymentMethods} payment methods.`);
        }
        newBot.currentPaymentMethods += 1;
        await newBot.save();
        console.log('📈 Incremented new bot usage:', newBot.currentPaymentMethods);
      }
    }
    
    // If no botId in request, keep existing botId
    const finalBotId = botId || method.botId;
    console.log('📌 Final botId:', finalBotId);
    
    const updateData = {
      name, 
      type, 
      accountName, 
      accountNumber, 
      clabe: clabe || '', 
      bankName, 
      instructions, 
      qrCode: qrCode || '',
      isActive: isActive === 'on' || isActive === true,
      botId: finalBotId
    };
    
    console.log('📝 Update data:', updateData);
    
    const updated = await PaymentMethod.findByIdAndUpdate(req.params.id, updateData, { new: true });
    console.log('✅ Method updated:', updated._id);
    
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('❌ Update method error details:', err);
    console.error('Stack:', err.stack);
    res.status(400).send('Error updating configuration: ' + err.message);
  }
};

// Delete method
exports.deleteMethod = async (req, res) => {
  try {
    console.log('🗑️ Deleting method:', req.params.id);
    
    const method = await PaymentMethod.findById(req.params.id);
    if (!method) {
      console.log('❌ Method not found for delete:', req.params.id);
      return res.status(404).json({ error: 'Method not found' });
    }
    
    // Check if admin owns this method's bot (unless superadmin)
    if (req.admin.role !== 'superadmin') {
      const bot = await Bot.findById(method.botId);
      if (!bot || bot.createdBy.toString() !== req.admin.id) {
        console.log('❌ Admin does not own this bot');
        return res.status(403).json({ error: 'You do not have permission to delete this method.' });
      }
    }
    
    // Decrement bot usage
    if (method.botId) {
      const bot = await Bot.findById(method.botId);
      if (bot && bot.currentPaymentMethods > 0) {
        bot.currentPaymentMethods -= 1;
        await bot.save();
        console.log('📉 Decremented bot usage after delete:', bot.currentPaymentMethods);
      }
    }
    
    await PaymentMethod.findByIdAndDelete(req.params.id);
    console.log('✅ Method deleted:', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Delete method error:', err);
    res.status(500).json({ error: 'Failed to delete entry: ' + err.message });
  }
};

// Get methods by bot (API)
exports.getMethodsByBot = async (req, res) => {
  try {
    const { botId } = req.params;
    const methods = await PaymentMethod.find({ botId, isActive: true });
    res.json(methods);
  } catch (err) {
    console.error('Get methods by bot error:', err);
    res.status(500).json({ error: 'Failed to fetch methods.' });
  }
};