const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  // Bot Info
  botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot' },
  botName: { type: String },
  
  // Customer Info
  customerId: { type: String, required: true },
  customerUsername: { type: String, default: '' },
  customerFirstName: { type: String, default: '' },
  customerLastName: { type: String, default: '' },
  customerChatId: { type: String },
  
  // Payment Info
  paymentMethodId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMethod' },
  paymentMethodName: { type: String },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  
  // Receipt
  receiptFileId: { type: String },
  receiptUrl: { type: String },
  
  // Status
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'completed', 'failed'], 
    default: 'pending' 
  },
  
  // Merchant Actions
  merchantId: { type: String },
  merchantChatId: { type: String },
  approvedAt: { type: Date },
  rejectedAt: { type: Date },
  completedAt: { type: Date },
  
  // Messages
  customerMessage: { type: String },
  merchantMessage: { type: String },
  
  // Metadata
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String },
  userAgent: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for faster queries
TransactionSchema.index({ customerId: 1 });
TransactionSchema.index({ botId: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ createdAt: -1 });

// Methods
TransactionSchema.methods.getStatusText = function() {
  const statusMap = {
    pending: '⏳ Pending',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    completed: '🎉 Completed',
    failed: '⚠️ Failed'
  };
  return statusMap[this.status] || this.status;
};

TransactionSchema.methods.getStatusColor = function() {
  const colorMap = {
    pending: '#f59e0b',
    approved: '#22c55e',
    rejected: '#ef4444',
    completed: '#3b82f6',
    failed: '#dc2626'
  };
  return colorMap[this.status] || '#64748b';
};

// Static methods
TransactionSchema.statics.getStats = async function(botId) {
  try {
    const match = botId ? { botId: new mongoose.Types.ObjectId(botId) } : {};
    const stats = await this.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    const result = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      completed: 0,
      failed: 0,
      totalAmount: 0
    };
    
    stats.forEach(stat => {
      result[stat._id] = stat.count;
      result.total += stat.count;
      result.totalAmount += stat.totalAmount || 0;
    });
    
    return result;
  } catch (err) {
    console.error('Get stats error:', err);
    return {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      completed: 0,
      failed: 0,
      totalAmount: 0
    };
  }
};

module.exports = mongoose.model('Transaction', TransactionSchema);