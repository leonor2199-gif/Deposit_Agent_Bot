require('dotenv').config();
const connectDB = require('../config/db');
const Bot = require('../models/Bot');
const Admin = require('../models/Admin');

const cleanup = async () => {
  try {
    await connectDB();
    console.log('📦 Connected to MongoDB');

    // Check for duplicate bots
    const bots = await Bot.find({});
    console.log(`📋 Found ${bots.length} bots`);
    
    // Check for duplicate tokens
    const tokens = {};
    for (const bot of bots) {
      if (tokens[bot.botToken]) {
        console.log(`⚠️ Duplicate token found for bot: ${bot.name}`);
        await Bot.findByIdAndDelete(bot._id);
        console.log(`🗑️ Deleted duplicate bot: ${bot.name}`);
      } else {
        tokens[bot.botToken] = true;
      }
    }

    // Reset admin counts
    await Admin.updateMany({}, { 
      $set: { 
        currentBots: 0, 
        currentPaymentMethods: 0, 
        currentGroups: 0,
        currentAdmins: 0,
        currentMessagesToday: 0
      } 
    });
    console.log('🔄 Reset admin usage counts');

    console.log('✅ Cleanup completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

cleanup();