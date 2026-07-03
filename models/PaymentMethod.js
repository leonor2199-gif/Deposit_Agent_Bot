const mongoose = require('mongoose');

const PaymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['bank', 'wallet', 'cash', 'card'], required: true },
  accountName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  clabe: { type: String, trim: true, default: '' },
  bankName: { type: String, required: true, trim: true },
  instructions: { type: String, required: true },
  qrCode: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true } // Track who created it
}, { timestamps: true });

// Index for faster queries
PaymentMethodSchema.index({ botId: 1 });
PaymentMethodSchema.index({ createdBy: 1 });
PaymentMethodSchema.index({ isActive: 1 });

module.exports = mongoose.model('PaymentMethod', PaymentMethodSchema);