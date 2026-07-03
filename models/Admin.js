const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true, sparse: true },
  
  // Admin Role
  role: { 
    type: String, 
    enum: ['superadmin', 'admin'], 
    default: 'admin' 
  },
  
  // Plan - ONLY THESE 4 PLANS
  plan: {
    type: String,
    enum: ['demo', 'starter', 'pro', 'enterprise'],
    default: 'demo'
  },
  
  // ============ PLAN LIMITS (from Plan model) ============
  maxBots: { type: Number, default: 1 },
  maxMessagesPerDay: { type: Number, default: 20 },
  maxMessages: { type: Number, default: 20 },
  maxAdmins: { type: Number, default: 0 }, // Always 0 for paid plans
  maxPaymentMethods: { type: Number, default: 5 },
  maxGroups: { type: Number, default: 1 },
  
  // ============ CURRENT USAGE ============
  currentBots: { type: Number, default: 0 },
  currentMessagesToday: { type: Number, default: 0 },
  currentMessagesTotal: { type: Number, default: 0 },
  currentAdmins: { type: Number, default: 0 },
  currentPaymentMethods: { type: Number, default: 0 },
  currentGroups: { type: Number, default: 0 },
  
  // Last reset date for daily limits
  lastDailyReset: { type: Date, default: Date.now },
  
  // ============ FEATURES ============
  features: {
    canManageAdmins: { type: Boolean, default: false },
    canManageBots: { type: Boolean, default: true },
    canManagePaymentMethods: { type: Boolean, default: true },
    canManageGroups: { type: Boolean, default: true },
    canManagePlans: { type: Boolean, default: false },
    canManageTransactions: { type: Boolean, default: true },
    canViewAnalytics: { type: Boolean, default: true },
    canExportData: { type: Boolean, default: false },
    canAccessAPI: { type: Boolean, default: false },
    canManageWebhooks: { type: Boolean, default: false }
  },
  
  // Access Control
  accessibleGroups: [{
    chatId: { type: String, required: true },
    groupName: { type: String, required: true }
  }],
  canManageAllGroups: { type: Boolean, default: false },
  canManageAllBots: { type: Boolean, default: false },
  
  // Bot Assignment
  botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', default: null },
  
  // Subscription
  subscriptionExpiry: { type: Date, default: null },
  isSubscriptionActive: { type: Boolean, default: true },
  
  // Status
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  
  // Metadata
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Pre-save middleware
AdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  this.updatedAt = new Date();
  next();
});

// Methods
AdminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Reset daily message counter
AdminSchema.methods.resetDailyCounter = async function() {
  const now = new Date();
  const lastReset = this.lastDailyReset || new Date(0);
  const hoursDiff = (now - lastReset) / (1000 * 60 * 60);
  
  if (hoursDiff >= 24) {
    this.currentMessagesToday = 0;
    this.lastDailyReset = now;
    await this.save();
  }
};

// Check if admin has permission
AdminSchema.methods.hasPermission = function(permission) {
  if (this.role === 'superadmin') return true;
  return this.features[permission] || false;
};

// Check if admin is within limits
AdminSchema.methods.isWithinLimits = function(type) {
  const limits = {
    bots: this.maxBots,
    admins: this.maxAdmins,
    paymentMethods: this.maxPaymentMethods,
    groups: this.maxGroups
  };
  
  const current = {
    bots: this.currentBots,
    admins: this.currentAdmins,
    paymentMethods: this.currentPaymentMethods,
    groups: this.currentGroups
  };
  
  // Infinity means unlimited
  if (limits[type] === Infinity || limits[type] === 0) {
    return true;
  }
  
  return current[type] < limits[type];
};

// Check daily message limit
AdminSchema.methods.canSendMessage = async function() {
  await this.resetDailyCounter();
  if (this.maxMessagesPerDay === Infinity) return true;
  return this.currentMessagesToday < this.maxMessagesPerDay;
};

// Increment usage
AdminSchema.methods.incrementUsage = async function(type) {
  const types = {
    bots: 'currentBots',
    admins: 'currentAdmins',
    paymentMethods: 'currentPaymentMethods',
    groups: 'currentGroups',
    messages: 'currentMessagesTotal',
    messagesToday: 'currentMessagesToday'
  };
  
  if (types[type] && this[types[type]] !== undefined) {
    this[types[type]] += 1;
    await this.save();
  }
};

// Decrement usage
AdminSchema.methods.decrementUsage = async function(type) {
  const types = {
    bots: 'currentBots',
    admins: 'currentAdmins',
    paymentMethods: 'currentPaymentMethods',
    groups: 'currentGroups'
  };
  
  if (types[type] && this[types[type]] > 0) {
    this[types[type]] -= 1;
    await this.save();
  }
};

// Get plan limits from Plan model
AdminSchema.statics.getPlanLimits = async function(planName) {
  const Plan = require('./Plan');
  const plan = await Plan.findOne({ name: planName });
  
  if (plan) {
    return {
      maxBots: plan.maxBots || 1,
      maxMessagesPerDay: plan.maxMessagesPerDay || 20,
      maxMessages: plan.maxMessages || 20,
      maxAdmins: plan.maxAdmins || 0,
      maxPaymentMethods: plan.maxPaymentMethods || 5,
      maxGroups: plan.maxGroups || 1,
      features: plan.features || {
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
      }
    };
  }
  
  // Default demo limits
  return {
    maxBots: 1,
    maxMessagesPerDay: 20,
    maxMessages: 20,
    maxAdmins: 0,
    maxPaymentMethods: 5,
    maxGroups: 1,
    features: {
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
    }
  };
};

module.exports = mongoose.model('Admin', AdminSchema);