const mongoose = require('mongoose');

const TelegramGroupSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  type: { type: String, enum: ['customer_facing', 'merchant_backoffice'], required: true },
  isActive: { type: Boolean, default: true },
  accessibleBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
  managedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', default: null }
}, { timestamps: true });

module.exports = mongoose.model('TelegramGroup', TelegramGroupSchema);