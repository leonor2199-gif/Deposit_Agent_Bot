const Admin = require('../models/Admin');

// Check if admin has specific permission
const hasPermission = (permission) => {
  return async (req, res, next) => {
    try {
      // Skip permission check for superadmin
      if (req.admin && req.admin.role === 'superadmin') {
        return next();
      }
      
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(403).json({ error: 'Admin not found' });
      }
      
      // Superadmin has all permissions
      if (admin.role === 'superadmin') {
        return next();
      }
      
      // Check if admin has the required permission
      if (admin.features && admin.features[permission]) {
        return next();
      }
      
      res.status(403).json({ 
        error: `Access denied. Requires permission: ${permission}` 
      });
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

// Check if admin is within limits
const withinLimits = (type) => {
  return async (req, res, next) => {
    try {
      // Skip limit check for superadmin
      if (req.admin && req.admin.role === 'superadmin') {
        return next();
      }
      
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(403).json({ error: 'Admin not found' });
      }
      
      // Superadmin bypasses limits
      if (admin.role === 'superadmin') {
        return next();
      }
      
      if (admin.isWithinLimits && admin.isWithinLimits(type)) {
        return next();
      }
      
      res.status(403).json({ 
        error: `Limit reached for ${type}. Your plan allows ${admin['max' + type.charAt(0).toUpperCase() + type.slice(1)] || 0}.` 
      });
    } catch (err) {
      console.error('Limit check error:', err);
      res.status(500).json({ error: 'Limit check failed' });
    }
  };
};

// Check if admin can access specific bot
const canAccessBot = (req, res, next) => {
  // This is a middleware function that takes (req, res, next)
  const botId = req.params.botId || req.params.id;
  
  if (!botId) {
    return next();
  }
  
  return async (req, res, next) => {
    try {
      // Superadmin can access all
      if (req.admin && req.admin.role === 'superadmin') {
        return next();
      }
      
      const admin = await Admin.findById(req.admin.id);
      if (!admin) {
        return res.status(403).json({ error: 'Admin not found' });
      }
      
      // Superadmin can access all
      if (admin.role === 'superadmin' || admin.canManageAllBots) {
        return next();
      }
      
      // Check if admin owns this bot
      const Bot = require('../models/Bot');
      const bot = await Bot.findById(botId);
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      
      if (String(bot.createdBy) === String(admin._id) || 
          String(admin.assignedBotId) === String(bot._id) ||
          String(admin.botId) === String(bot._id)) {
        return next();
      }
      
      res.status(403).json({ error: 'Access denied to this bot' });
    } catch (err) {
      console.error('Bot access check error:', err);
      res.status(500).json({ error: 'Bot access check failed' });
    }
  };
};

module.exports = { hasPermission, withinLimits, canAccessBot };