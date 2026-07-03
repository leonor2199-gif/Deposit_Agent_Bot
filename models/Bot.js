const mongoose = require('mongoose');

const BotSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  botToken: { type: String, required: true, unique: true },
  username: { type: String, trim: true },
  description: { type: String, default: '' },
  
  // Bot Status
  isActive: { type: Boolean, default: true },
  isOnline: { type: Boolean, default: false },
  
  // Pricing Plan
  plan: { 
    type: String, 
    enum: ['free', 'starter', 'pro', 'enterprise', 'lifetime'], 
    default: 'free' 
  },
  
  // Plan Limits
  maxMessages: { type: Number, default: 10 },
  maxAdmins: { type: Number, default: 0 },
  maxPaymentMethods: { type: Number, default: 3 },
  maxGroups: { type: Number, default: 1 },
  
  // Current Usage
  currentMessages: { type: Number, default: 0 },
  currentAdmins: { type: Number, default: 0 },
  currentPaymentMethods: { type: Number, default: 0 },
  currentGroups: { type: Number, default: 0 },
  
  // Telegram Configuration
  merchantChatId: { type: String, default: '' },
  mainGroupChatId: { type: String, default: '' },
  
  // Owner Info
  ownerId: { type: String, default: '' },
  ownerUsername: { type: String, default: '' },
  
  // Subscription
  subscriptionExpiry: { type: Date, default: null },
  isSubscriptionActive: { type: Boolean, default: true },
  paymentHistory: [{
    amount: Number,
    plan: String,
    paymentDate: Date,
    transactionId: String,
    status: { type: String, enum: ['pending', 'completed', 'failed'] }
  }],
  
  // Features
  features: {
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
  
  // Stats
  totalMessagesProcessed: { type: Number, default: 0 },
  totalReceiptsReceived: { type: Number, default: 0 },
  totalTransactions: { type: Number, default: 0 },
  
  // Ownership
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true }, // Who created this bot
  lastActive: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
BotSchema.index({ botToken: 1 });
BotSchema.index({ ownerId: 1 });
BotSchema.index({ isActive: 1 });
BotSchema.index({ createdBy: 1 });

// Methods
BotSchema.methods.isWithinLimits = function(type) {
  switch(type) {
    case 'messages':
      return this.maxMessages === Infinity || this.currentMessages < this.maxMessages;
    case 'admins':
      return this.maxAdmins === Infinity || this.currentAdmins < this.maxAdmins;
    case 'paymentMethods':
      return this.maxPaymentMethods === Infinity || this.currentPaymentMethods < this.maxPaymentMethods;
    case 'groups':
      return this.maxGroups === Infinity || this.currentGroups < this.maxGroups;
    default:
      return true;
  }
};

BotSchema.methods.incrementUsage = async function(type) {
  switch(type) {
    case 'messages':
      this.currentMessages += 1;
      this.totalMessagesProcessed += 1;
      break;
    case 'admins':
      this.currentAdmins += 1;
      break;
    case 'paymentMethods':
      this.currentPaymentMethods += 1;
      break;
    case 'groups':
      this.currentGroups += 1;
      break;
    case 'receipts':
      this.totalReceiptsReceived += 1;
      break;
    case 'transactions':
      this.totalTransactions += 1;
      break;
  }
  await this.save();
};

BotSchema.methods.decrementUsage = async function(type) {
  switch(type) {
    case 'admins':
      if (this.currentAdmins > 0) this.currentAdmins -= 1;
      break;
    case 'paymentMethods':
      if (this.currentPaymentMethods > 0) this.currentPaymentMethods -= 1;
      break;
    case 'groups':
      if (this.currentGroups > 0) this.currentGroups -= 1;
      break;
  }
  await this.save();
};

BotSchema.methods.getRemainingLimits = function() {
  return {
    messages: this.maxMessages === Infinity ? '∞' : Math.max(0, this.maxMessages - this.currentMessages),
    admins: this.maxAdmins === Infinity ? '∞' : Math.max(0, this.maxAdmins - this.currentAdmins),
    paymentMethods: this.maxPaymentMethods === Infinity ? '∞' : Math.max(0, this.maxPaymentMethods - this.currentPaymentMethods),
    groups: this.maxGroups === Infinity ? '∞' : Math.max(0, this.maxGroups - this.currentGroups)
  };
};

BotSchema.methods.checkSubscription = function() {
  if (!this.subscriptionExpiry) return this.plan === 'lifetime';
  return this.subscriptionExpiry > new Date() && this.isSubscriptionActive;
};

module.exports = mongoose.model('Bot', BotSchema);