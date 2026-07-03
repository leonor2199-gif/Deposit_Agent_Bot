const Admin = require('../models/Admin');
const Bot = require('../models/Bot');
const Plan = require('../models/Plan');
const TelegramGroup = require('../models/TelegramGroup');
const PaymentMethod = require('../models/PaymentMethod');
const jwt = require('jsonwebtoken');

// ============ AUTHENTICATION ============
exports.getLogin = (req, res) => {
  if (req.cookies.token) return res.redirect('/admin/dashboard');
  res.render('login', { error: null });
};

exports.postLogin = async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await Admin.findOne({ username, isActive: true });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.render('login', { error: 'Invalid username or password.' });
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role, plan: admin.plan }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1d' }
    );
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An error occurred during authentication.' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.redirect('/admin/login');
};

// ============ PERMISSIONS ============
exports.getMyPermissions = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }
    
    await admin.resetDailyCounter();
    
    res.json({
      role: admin.role,
      plan: admin.plan,
      permissions: admin.features,
      limits: {
        bots: `${admin.currentBots}/${admin.maxBots === Infinity ? '∞' : admin.maxBots}`,
        admins: `${admin.currentAdmins}/${admin.maxAdmins === Infinity ? '∞' : admin.maxAdmins}`,
        paymentMethods: `${admin.currentPaymentMethods}/${admin.maxPaymentMethods === Infinity ? '∞' : admin.maxPaymentMethods}`,
        groups: `${admin.currentGroups}/${admin.maxGroups === Infinity ? '∞' : admin.maxGroups}`,
        messagesToday: `${admin.currentMessagesToday}/${admin.maxMessagesPerDay === Infinity ? '∞' : admin.maxMessagesPerDay}`
      }
    });
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ error: 'Failed to fetch permissions.' });
  }
};

// ============ DASHBOARD ============
exports.getDashboard = async (req, res) => {
  try {
    const currentAdmin = await Admin.findById(req.admin.id);
    if (!currentAdmin) {
      return res.status(404).send('Admin not found.');
    }

    await currentAdmin.resetDailyCounter();

    let botQuery = {};
    if (req.admin.role !== 'superadmin') {
      botQuery.createdBy = req.admin.id;
    }
    const bots = await Bot.find(botQuery).sort({ createdAt: -1 });
    const botIds = bots.map(b => b._id);

    let methodQuery = {};
    if (req.admin.role !== 'superadmin') {
      if (botIds.length > 0) {
        methodQuery.botId = { $in: botIds };
      } else {
        methodQuery._id = { $in: [] };
      }
    }
    const methods = await PaymentMethod.find(methodQuery)
      .populate('botId', 'name plan')
      .sort({ createdAt: -1 });

    let groups = [];
    if (req.admin.role === 'superadmin') {
      groups = await TelegramGroup.find({ isActive: true });
    } else {
      groups = await TelegramGroup.find({
        accessibleBy: req.admin.id,
        isActive: true
      });
    }

    const stats = {
      totalBots: bots.length,
      totalMethods: methods.length,
      activeMethods: methods.filter(m => m.isActive).length,
      totalGroups: groups.length,
      totalAdmins: await Admin.countDocuments({ createdBy: req.admin.id, isActive: true }),
      messagesToday: currentAdmin.currentMessagesToday || 0,
      messagesLimit: currentAdmin.maxMessagesPerDay === Infinity ? '∞' : currentAdmin.maxMessagesPerDay
    };

    const isLimitReached = {
      bots: currentAdmin.currentBots >= currentAdmin.maxBots && currentAdmin.maxBots !== Infinity,
      admins: currentAdmin.currentAdmins >= currentAdmin.maxAdmins && currentAdmin.maxAdmins !== Infinity,
      paymentMethods: currentAdmin.currentPaymentMethods >= currentAdmin.maxPaymentMethods && currentAdmin.maxPaymentMethods !== Infinity,
      groups: currentAdmin.currentGroups >= currentAdmin.maxGroups && currentAdmin.maxGroups !== Infinity,
      messages: currentAdmin.currentMessagesToday >= currentAdmin.maxMessagesPerDay && currentAdmin.maxMessagesPerDay !== Infinity
    };

    const canAdd = {
      bot: currentAdmin.isWithinLimits('bots'),
      admin: currentAdmin.isWithinLimits('admins'),
      paymentMethod: currentAdmin.isWithinLimits('paymentMethods'),
      group: currentAdmin.isWithinLimits('groups')
    };

    res.render('dashboard', {
      methods: methods || [],
      groups: groups || [],
      bots: bots || [],
      stats: stats,
      admin: req.admin,
      currentAdmin: currentAdmin,
      isSuperAdmin: req.admin.role === 'superadmin',
      isLimitReached: isLimitReached,
      canAdd: canAdd,
      isDemo: currentAdmin.plan === 'demo'
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard: ' + err.message);
  }
};

// ============ ADMIN MANAGEMENT ============
exports.getAdmins = async (req, res) => {
  try {
    console.log('✅ getAdmins called');
    
    let query = {};
    if (req.admin.role !== 'superadmin') {
      query.createdBy = req.admin.id;
    }
    
    const admins = await Admin.find(query)
      .populate('createdBy', 'username')
      .populate('botId', 'name')
      .sort({ createdAt: -1 });
    
    console.log('📋 Found admins:', admins.length);
    
    const groups = await TelegramGroup.find({ isActive: true });
    const bots = await Bot.find({ isActive: true });
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    
    const currentAdmin = await Admin.findById(req.admin.id);
    
    res.render('admins', { 
      admins: admins || [],
      groups: groups || [],
      bots: bots || [],
      plans: plans || [],
      adminData: req.admin,
      currentAdmin: currentAdmin,
      isSuperAdmin: req.admin.role === 'superadmin'
    });
  } catch (err) {
    console.error('❌ Error loading admins:', err);
    res.status(500).send('Error loading admin management: ' + err.message);
  }
};

exports.createAdmin = async (req, res) => {
  try {
    const { username, password, email, role, plan, accessibleGroups, botId, notes } = req.body;
    
    const existing = await Admin.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Username already exists.' });
    }

    if (req.admin.role !== 'superadmin') {
      const currentAdmin = await Admin.findById(req.admin.id);
      if (!currentAdmin.hasPermission('canManageAdmins')) {
        return res.status(403).json({ error: 'You do not have permission to manage admins.' });
      }
      if (!currentAdmin.isWithinLimits('admins')) {
        return res.status(400).json({ 
          error: `Admin limit reached. Your plan allows ${currentAdmin.maxAdmins} admins.` 
        });
      }
    }

    const planLimits = await Admin.getPlanLimits(plan || 'demo');
    
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const admin = new Admin({
      username,
      password,
      email: email || '',
      role: role || 'admin',
      plan: plan || 'demo',
      maxBots: planLimits.maxBots || 1,
      maxMessagesPerDay: planLimits.maxMessagesPerDay || 20,
      maxMessages: planLimits.maxMessages || 20,
      maxAdmins: planLimits.maxAdmins || 0,
      maxPaymentMethods: planLimits.maxPaymentMethods || 5,
      maxGroups: planLimits.maxGroups || 1,
      features: planLimits.features || {
        canManageAdmins: false,
        canManageBots: true,
        canManagePaymentMethods: true,
        canManageGroups: true,
        canManagePlans: false,
        canManageTransactions: true,
        canViewAnalytics: true,
        canExportData: false,
        canAccessAPI: false,
        canManageWebhooks: false
      },
      createdBy: req.admin.id,
      accessibleGroups: accessibleGroups || [],
      isActive: true,
      botId: botId || null,
      notes: notes || '',
      subscriptionExpiry: plan === 'lifetime' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await admin.save();
    
    if (req.admin.role !== 'superadmin') {
      const currentAdmin = await Admin.findById(req.admin.id);
      await currentAdmin.incrementUsage('admins');
    }
    
    if (accessibleGroups && accessibleGroups.length > 0) {
      const groupIds = accessibleGroups.map(g => g.chatId);
      await TelegramGroup.updateMany(
        { chatId: { $in: groupIds } },
        { $addToSet: { accessibleBy: admin._id } }
      );
    }

    res.json({ success: true, message: 'Admin created successfully.', admin });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create admin: ' + err.message });
  }
};

exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, plan, isActive, accessibleGroups, password, botId, notes, features } = req.body;

    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    if (req.admin.role !== 'superadmin') {
      if (plan && plan !== admin.plan) {
        return res.status(403).json({ error: 'Only superadmin can change plans.' });
      }
      if (role && role !== admin.role) {
        return res.status(403).json({ error: 'Only superadmin can change roles.' });
      }
    }

    if (id === req.admin.id && isActive === false) {
      return res.status(400).json({ error: 'Cannot deactivate your own account.' });
    }

    if (id === req.admin.id && role === 'admin' && admin.role === 'superadmin') {
      const superadminCount = await Admin.countDocuments({ role: 'superadmin', isActive: true });
      if (superadminCount <= 1) {
        return res.status(400).json({ error: 'Cannot downgrade your own role. You are the only superadmin.' });
      }
    }

    if (username) admin.username = username;
    if (email !== undefined) admin.email = email;
    if (role) admin.role = role;
    if (plan) {
      admin.plan = plan;
      const planLimits = await Admin.getPlanLimits(plan);
      admin.maxBots = planLimits.maxBots || 0;
      admin.maxMessagesPerDay = planLimits.maxMessagesPerDay || 20;
      admin.maxMessages = planLimits.maxMessages || 20;
      admin.maxAdmins = planLimits.maxAdmins || 0;
      admin.maxPaymentMethods = planLimits.maxPaymentMethods || 5;
      admin.maxGroups = planLimits.maxGroups || 1;
      admin.features = planLimits.features || admin.features;
    }
    if (isActive !== undefined) admin.isActive = isActive;
    if (botId !== undefined) admin.botId = botId;
    if (notes !== undefined) admin.notes = notes;
    if (features) admin.features = { ...admin.features, ...features };
    
    if (password && password.length >= 6) {
      admin.password = password;
    } else if (password && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    
    if (accessibleGroups) {
      admin.accessibleGroups = accessibleGroups;
      await TelegramGroup.updateMany(
        { accessibleBy: admin._id },
        { $pull: { accessibleBy: admin._id } }
      );
      const groupIds = accessibleGroups.map(g => g.chatId);
      await TelegramGroup.updateMany(
        { chatId: { $in: groupIds } },
        { $addToSet: { accessibleBy: admin._id } }
      );
    }

    admin.updatedAt = new Date();
    await admin.save();
    res.json({ success: true, message: 'Admin updated successfully.', admin });
  } catch (err) {
    console.error('Update admin error:', err);
    res.status(500).json({ error: 'Failed to update admin: ' + err.message });
  }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (id === req.admin.id) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    if (admin.role === 'superadmin') {
      const superadminCount = await Admin.countDocuments({ role: 'superadmin', isActive: true });
      if (superadminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the only superadmin.' });
      }
    }

    if (admin.createdBy) {
      const creator = await Admin.findById(admin.createdBy);
      if (creator && creator.role !== 'superadmin' && creator.currentAdmins > 0) {
        creator.currentAdmins -= 1;
        await creator.save();
      }
    }

    if (admin.botId) {
      const bot = await Bot.findById(admin.botId);
      if (bot && bot.currentAdmins > 0) {
        bot.currentAdmins -= 1;
        await bot.save();
      }
    }

    await Admin.findByIdAndDelete(id);
    await TelegramGroup.updateMany(
      { accessibleBy: id },
      { $pull: { accessibleBy: id } }
    );
    
    res.json({ success: true, message: 'Admin deleted successfully.' });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ error: 'Failed to delete admin: ' + err.message });
  }
};

exports.getAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await Admin.findById(id)
      .populate('createdBy', 'username')
      .populate('botId', 'name plan');
    
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }
    
    res.json(admin);
  } catch (err) {
    console.error('Get admin error:', err);
    res.status(500).json({ error: 'Failed to fetch admin: ' + err.message });
  }
};

// ============ GROUP MANAGEMENT ============
exports.getGroups = async (req, res) => {
  try {
    let groups;
    if (req.admin.role === 'superadmin') {
      groups = await TelegramGroup.find()
        .populate('accessibleBy', 'username')
        .populate('managedBy', 'username')
        .sort({ createdAt: -1 });
    } else {
      groups = await TelegramGroup.find({
        accessibleBy: req.admin.id,
        isActive: true
      })
        .populate('accessibleBy', 'username')
        .populate('managedBy', 'username')
        .sort({ createdAt: -1 });
    }
    const bots = await Bot.find({ isActive: true });
    res.render('groups', { 
      groups: groups || [], 
      bots: bots || [],
      isSuperAdmin: req.admin.role === 'superadmin',
      adminData: req.admin
    });
  } catch (err) {
    console.error('Error loading groups:', err);
    res.status(500).send('Error loading groups: ' + err.message);
  }
};

exports.createGroup = async (req, res) => {
  try {
    const { chatId, title, type, accessibleTo, botId } = req.body;

    const existing = await TelegramGroup.findOne({ chatId });
    if (existing) {
      return res.status(400).json({ error: 'Group with this Chat ID already exists.' });
    }

    if (botId) {
      const bot = await Bot.findById(botId);
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found.' });
      }
      if (!bot.isWithinLimits('groups')) {
        return res.status(400).json({ 
          error: `Group limit reached. Current plan (${bot.plan}) allows ${bot.maxGroups} groups.` 
        });
      }
    }

    const group = new TelegramGroup({
      chatId,
      title,
      type,
      managedBy: req.admin.id,
      accessibleBy: accessibleTo || [req.admin.id],
      isActive: true,
      botId: botId || null
    });

    await group.save();

    if (botId) {
      const bot = await Bot.findById(botId);
      if (bot) {
        await bot.incrementUsage('groups');
      }
    }

    res.json({ success: true, message: 'Group added successfully.', group });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to add group: ' + err.message });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, isActive, accessibleTo, botId } = req.body;

    const group = await TelegramGroup.findById(id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    if (req.admin.role !== 'superadmin' && !group.accessibleBy.includes(req.admin.id)) {
      return res.status(403).json({ error: 'Access denied to this group.' });
    }

    if (title) group.title = title;
    if (type) group.type = type;
    if (isActive !== undefined) group.isActive = isActive;
    if (botId !== undefined) group.botId = botId;
    if (accessibleTo) {
      if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ error: 'Only superadmin can change group access.' });
      }
      group.accessibleBy = accessibleTo;
    }

    await group.save();
    res.json({ success: true, message: 'Group updated successfully.', group });
  } catch (err) {
    console.error('Update group error:', err);
    res.status(500).json({ error: 'Failed to update group: ' + err.message });
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await TelegramGroup.findById(id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    if (req.admin.role !== 'superadmin' && String(group.managedBy) !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (group.botId) {
      const bot = await Bot.findById(group.botId);
      if (bot && bot.currentGroups > 0) {
        bot.currentGroups -= 1;
        await bot.save();
      }
    }

    await TelegramGroup.findByIdAndDelete(id);
    res.json({ success: true, message: 'Group deleted successfully.' });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Failed to delete group: ' + err.message });
  }
};

exports.getGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await TelegramGroup.findById(id)
      .populate('accessibleBy', 'username')
      .populate('managedBy', 'username');
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    res.json(group);
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Failed to fetch group: ' + err.message });
  }
};