const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  // Plan Identification
  name: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  description: { type: String, default: '' },
  
  // Pricing
  price: { type: Number, required: true, default: 0 },
  currency: { type: String, default: 'USD' },
  interval: { 
    type: String, 
    enum: ['monthly', 'yearly', 'one-time', 'forever'], 
    default: 'monthly' 
  },
  
  // ============ PLAN LIMITS ============
  // Bot Limits
  maxBots: { type: Number, default: 1 },
  maxMessagesPerDay: { type: Number, default: 20 },
  maxMessages: { type: Number, default: 20 },
  
  // Admin Limits (can't add admins for paid plans)
  maxAdmins: { type: Number, default: 0 },
  
  // Payment Method Limits
  maxPaymentMethods: { type: Number, default: 5 },
  
  // Group Limits
  maxGroups: { type: Number, default: 1 },
  
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
  
  // Bot Features
  botFeatures: {
    qrCodeSupport: { type: Boolean, default: true },
    customMessages: { type: Boolean, default: false },
    multiLanguage: { type: Boolean, default: false },
    analytics: { type: Boolean, default: false },
    exportData: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
    customBranding: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false }
  },
  
  // Settings
  settings: {
    autoDeleteMessages: { type: Boolean, default: true },
    messageDeleteDelay: { type: Number, default: 15 },
    requirePhoto: { type: Boolean, default: true },
    allowCustomAmount: { type: Boolean, default: false },
    maxFileSize: { type: Number, default: 20 },
    allowedFileTypes: { type: [String], default: ['jpg', 'png', 'pdf'] }
  },
  
  // Display
  isActive: { type: Boolean, default: true },
  isPopular: { type: Boolean, default: false },
  badge: { type: String, default: '' },
  order: { type: Number, default: 0 },
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
});

// Update timestamp on save
PlanSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to get default plans
PlanSchema.statics.getDefaultPlans = function() {
  return [
    {
      name: 'demo',
      displayName: 'Demo',
      description: 'Test the system - 20 messages daily',
      price: 0,
      currency: 'USD',
      interval: 'forever',
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
      },
      botFeatures: {
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
      },
      isActive: true,
      isPopular: false,
      badge: 'Free Demo',
      order: 0
    },
    {
      name: 'starter',
      displayName: 'Starter',
      description: '2 bots, 5 banks, no message limit',
      price: 29,
      currency: 'USD',
      interval: 'monthly',
      maxBots: 2,
      maxMessagesPerDay: Infinity,
      maxMessages: Infinity,
      maxAdmins: 0,
      maxPaymentMethods: 5,
      maxGroups: 2,
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
      },
      botFeatures: {
        qrCodeSupport: true,
        customMessages: true,
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
        allowCustomAmount: true,
        maxFileSize: 20,
        allowedFileTypes: ['jpg', 'png', 'pdf']
      },
      isActive: true,
      isPopular: false,
      badge: 'Starter',
      order: 1
    },
    {
      name: 'pro',
      displayName: 'Professional',
      description: '5 bots, 7 banks, 5 groups',
      price: 99,
      currency: 'USD',
      interval: 'monthly',
      maxBots: 5,
      maxMessagesPerDay: Infinity,
      maxMessages: Infinity,
      maxAdmins: 0,
      maxPaymentMethods: 7,
      maxGroups: 5,
      features: {
        canManageAdmins: false,
        canManageBots: true,
        canManagePaymentMethods: true,
        canManageGroups: true,
        canManagePlans: false,
        canManageTransactions: true,
        canViewAnalytics: true,
        canExportData: true,
        canAccessAPI: true,
        canManageWebhooks: true
      },
      botFeatures: {
        qrCodeSupport: true,
        customMessages: true,
        multiLanguage: true,
        analytics: true,
        exportData: false,
        prioritySupport: true,
        customBranding: false,
        apiAccess: false
      },
      settings: {
        autoDeleteMessages: true,
        messageDeleteDelay: 30,
        requirePhoto: true,
        allowCustomAmount: true,
        maxFileSize: 50,
        allowedFileTypes: ['jpg', 'png', 'pdf', 'doc', 'docx']
      },
      isActive: true,
      isPopular: true,
      badge: 'Popular',
      order: 2
    },
    {
      name: 'enterprise',
      displayName: 'Enterprise',
      description: '10 bots, unlimited banks, 10 groups',
      price: 299,
      currency: 'USD',
      interval: 'monthly',
      maxBots: 10,
      maxMessagesPerDay: Infinity,
      maxMessages: Infinity,
      maxAdmins: 0,
      maxPaymentMethods: Infinity,
      maxGroups: 10,
      features: {
        canManageAdmins: false,
        canManageBots: true,
        canManagePaymentMethods: true,
        canManageGroups: true,
        canManagePlans: false,
        canManageTransactions: true,
        canViewAnalytics: true,
        canExportData: true,
        canAccessAPI: true,
        canManageWebhooks: true
      },
      botFeatures: {
        qrCodeSupport: true,
        customMessages: true,
        multiLanguage: true,
        analytics: true,
        exportData: true,
        prioritySupport: true,
        customBranding: true,
        apiAccess: true
      },
      settings: {
        autoDeleteMessages: true,
        messageDeleteDelay: 60,
        requirePhoto: true,
        allowCustomAmount: true,
        maxFileSize: 100,
        allowedFileTypes: ['jpg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx']
      },
      isActive: true,
      isPopular: false,
      badge: 'Enterprise',
      order: 3
    }
  ];
};

module.exports = mongoose.model('Plan', PlanSchema);