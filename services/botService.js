const TelegramBot = require('node-telegram-bot-api');
const PaymentMethod = require('../models/PaymentMethod');
const TelegramGroup = require('../models/TelegramGroup');
const Bot = require('../models/Bot');
const Admin = require('../models/Admin');

// Store bot instances
const botInstances = new Map();

// Initialize a single bot
const initBot = async (botToken, botId) => {
  try {
    // Check if bot already exists
    if (botInstances.has(botId)) {
      console.log(`ℹ️ Bot ${botId} already running`);
      return botInstances.get(botId);
    }

    // Get bot data from database
    const botData = await Bot.findById(botId);
    if (!botData) {
      console.error(`❌ Bot ${botId} not found in database`);
      return null;
    }

    if (!botData.isActive) {
      console.log(`ℹ️ Bot ${botData.name} is inactive, skipping initialization`);
      return null;
    }

    // Check if bot has required configuration
    if (!botData.merchantChatId || !botData.mainGroupChatId) {
      console.error(`❌ Bot ${botData.name} missing merchantChatId or mainGroupChatId. Bot will not work.`);
      await Bot.findByIdAndUpdate(botId, { 
        isOnline: false,
        lastActive: new Date()
      });
      return null;
    }

    const bot = new TelegramBot(botToken, { polling: true });
    
    // Store bot instance
    botInstances.set(botId, bot);

    // Update bot status in database
    await Bot.findByIdAndUpdate(botId, { 
      isOnline: true, 
      lastActive: new Date() 
    });

    console.log(`✅ Bot ${botData.name} (${botId}) initialized successfully`);
    console.log(`   📌 Merchant Chat ID: ${botData.merchantChatId}`);
    console.log(`   📌 Main Group Chat ID: ${botData.mainGroupChatId}`);

    // Helper function to check admin limits
    const checkAdminLimits = async (botId, chatId) => {
      const admin = await Admin.findOne({ botId: botId });
      if (!admin) return { allowed: true };
      
      await admin.resetDailyCounter();
      
      if (!await admin.canSendMessage()) {
        return {
          allowed: false,
          message: `⚠️ <b>Daily message limit reached!</b>\n\n` +
                   `You have used ${admin.currentMessagesToday} out of ${admin.maxMessagesPerDay === Infinity ? '∞' : admin.maxMessagesPerDay} messages today.\n\n` +
                   `💎 <b>Upgrade your plan</b> for unlimited messages.\n` +
                   `Current Plan: ${admin.plan.toUpperCase()}\n\n` +
                   `Contact: ${process.env.CONTACT_URL || 'support@your-site.com'}`
        };
      }
      
      await admin.incrementUsage('messagesToday');
      return { allowed: true };
    };

    // --- MESSAGE HANDLER ---
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      // Get fresh bot data
      const currentBot = await Bot.findById(botId);
      if (!currentBot || !currentBot.isActive) {
        await safeSendMessage(bot, chatId, '❌ This bot is no longer active.');
        return;
      }

      // Check if bot has required configuration
      if (!currentBot.merchantChatId || !currentBot.mainGroupChatId) {
        await safeSendMessage(bot, chatId, 
          '❌ Bot is not properly configured. Please contact administrator.\n' +
          '机器人未正确配置，请联系管理员。'
        );
        return;
      }

      // Check if the chat is authorized
      const chatIdStr = String(chatId);
      const merchantChatIdStr = String(currentBot.merchantChatId);
      const mainGroupChatIdStr = String(currentBot.mainGroupChatId);
      
      const isMerchantChat = (chatIdStr === merchantChatIdStr);
      const isMainGroup = (chatIdStr === mainGroupChatIdStr);
      
      if (!isMerchantChat && !isMainGroup) {
        console.log(`ℹ️ Unauthorized chat ${chatIdStr} tried to use bot ${currentBot.name}`);
        return;
      }

      // Check admin limits for BOTH merchant and main group
      const adminCheck = await checkAdminLimits(botId, chatId);
      if (!adminCheck.allowed) {
        await safeSendMessage(bot, chatId, adminCheck.message);
        return;
      }

      // Check message limits for bot (only for main group)
      if (isMainGroup) {
        if (!currentBot.isWithinLimits('messages')) {
          await safeSendMessage(bot, chatId, 
            `⚠️ <b>Message limit reached!</b>\n\n` +
            `You have used ${currentBot.currentMessages} out of ${currentBot.maxMessages === Infinity ? '∞' : currentBot.maxMessages} messages.\n\n` +
            `💎 <b>Upgrade your plan</b> to continue using this bot.\n` +
            `Current Plan: ${currentBot.plan.toUpperCase()}\n\n` +
            `Contact: ${process.env.CONTACT_URL || 'support@your-site.com'}`
          );
          return;
        }

        await currentBot.incrementUsage('messages');
      }

      // --- COMMAND HANDLING ---
      
      // START command - Show main menu with buttons
      if (text === '/start') {
        if (!isMainGroup && !isMerchantChat) return;
        return sendMainMenu(bot, chatId, "👋 Welcome to the Payment Pipeline!");
      }

      // HELP command
      if (text === 'ℹ️ Help / How to Pay' || text === '/help') {
        if (!isMainGroup && !isMerchantChat) return;
        const helpMsg = `💡 <b>How to make a secure deposit:</b>\n\n` +
                        `1️⃣ Click <b>🏛️ Choose Payment Method</b>.\n` +
                        `2️⃣ Choose your bank.\n` +
                        `3️⃣ <b>IMPORTANT:</b> Complete the transfer, then <b>Reply directly</b> to that bank details message with your receipt photo!`;
        return safeSendMessage(bot, chatId, helpMsg);
      }

      // CHOOSE PAYMENT METHOD button
      if (text === '🏛️ Choose Payment Method') {
        if (!isMainGroup) {
          await safeSendMessage(bot, chatId, 
            '❌ Payment methods are only available in the authorized group.\n' +
            '支付方式仅在授权的群组中可用。'
          );
          return;
        }
        return sendBankSelection(bot, chatId, msg.message_id, botId);
      }

      // If no text, handle photo messages (receipts)
      if (!text) {
        if (msg.photo && msg.reply_to_message) {
          const originalBotMsg = msg.reply_to_message;
          const botUserObj = await bot.getMe().catch(() => ({ id: null }));

          if (originalBotMsg.from.id === botUserObj.id && originalBotMsg.text?.includes('🏛️')) {
            const userHandle = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name}`;
            const userId = msg.from.id;
            const userChatId = msg.chat.id;
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const parsedBankContext = originalBotMsg.text.split('\n')[0] || "Active Transfer System";

            if (isMainGroup) {
              const merchantCaption = `🚨 <b>New Deposit Slip Received!</b>\n\n` +
                                      `👤 <b>Sender Account:</b> ${userHandle} (ID: <code>${userId}</code>)\n` +
                                      `💵 <b>Payment Context:</b> ${parsedBankContext}\n` +
                                      `📅 <b>Timestamp:</b> ${new Date().toLocaleString()}\n\n` +
                                      `📌 <b>Customer Group ID:</b> <code>${userChatId}</code>\n` +
                                      `📌 <b>Customer Message ID:</b> <code>${msg.message_id}</code>\n` +
                                      `🤖 <b>Bot:</b> ${currentBot.name}`;

              try {
                await bot.sendPhoto(currentBot.merchantChatId, fileId, {
                  caption: merchantCaption,
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "Confirmed ✅", callback_data: `mchk_approve_${userChatId}_${msg.message_id}` },
                        { text: "Reject ❌", callback_data: `mchk_reject_${userChatId}_${msg.message_id}` }
                      ],
                      [
                        { text: "💬 Custom Message", callback_data: `mchk_custom_${userChatId}_${msg.message_id}` }
                      ]
                    ]
                  }
                });

                const confirmationMsg = await safeSendMessage(bot, chatId, `✅ Thank you ${userHandle}, your receipt has been sent to the merchant team! Please wait for confirmation.`);
                if (confirmationMsg) {
                  scheduleDeletion(bot, chatId, confirmationMsg.message_id, 60000);
                }
                
                await currentBot.incrementUsage('receipts');
              } catch (error) {
                console.error("❌ Receipt forwarding failed:", error.message);
              }
            } else {
              await safeSendMessage(bot, chatId, 
                '❌ Please use this bot in the authorized group only.\n' +
                '请仅在授权的群组中使用此机器人。'
              );
            }
          }
        }
        return;
      }

      // Merchant custom message replies
      if (msg.reply_to_message && isMerchantChat) {
        const promptMsg = msg.reply_to_message;
        
        if (promptMsg.text && promptMsg.text.includes('✍️ CUSTOM MESSAGE INPUT:')) {
          try {
            const matchData = promptMsg.text.match(/\[CID:(.*?)\]\[MID:(.*?)\]/);
            if (!matchData) return;

            const customerChatId = matchData[1];
            const customerMsgId = matchData[2];

            const userMention = `<a href="tg://user?id=${customerChatId}">Customer</a>`;
            const relayedMerchantText = `💬 <b>Merchant Update:</b>\n\n📌 ${userMention}, ${text}\n\n_This message is from the merchant, please do not reply._`;

            await sendMerchantMessageToCustomer(bot, customerChatId, customerMsgId, relayedMerchantText, true);

            const successReceipt = await safeSendMessage(bot, currentBot.merchantChatId, `✅ Custom notification routed and delivered successfully!`);
            if (successReceipt) {
              scheduleDeletion(bot, currentBot.merchantChatId, successReceipt.message_id, 5000);
            }
            
            bot.deleteMessage(currentBot.merchantChatId, promptMsg.message_id).catch(() => {});
            bot.deleteMessage(currentBot.merchantChatId, msg.message_id).catch(() => {});

          } catch (err) {
            console.error("❌ Failed to forward custom merchant text:", err.message);
          }
          return;
        }

        if (promptMsg.text && promptMsg.text.includes('Merchant Update:')) {
          const warningMsg = await safeSendMessage(bot, currentBot.merchantChatId, 
            '⚠️ This is a system message sent to the customer. Please do not reply. Use the "💬 Custom Message" button to contact the customer.'
          );
          if (warningMsg) {
            scheduleDeletion(bot, currentBot.merchantChatId, warningMsg.message_id, 10000);
          }
          return;
        }
      }

      // Prevent customer reply loops
      if (msg.reply_to_message && isMainGroup) {
        const repliedText = msg.reply_to_message.text;
        if (repliedText && (repliedText.includes('Merchant Update:') || 
            repliedText.includes('Payment Received Successfully') || 
            repliedText.includes('Deposit Slip Rejected'))) {
          const warningMsg = await safeSendMessage(bot, chatId, 
            'ℹ️ This is a system message from the merchant. Please do not reply. Use "🏛️ Choose Payment Method" for help.'
          );
          if (warningMsg) {
            scheduleDeletion(bot, chatId, warningMsg.message_id, 30000);
          }
          return;
        }
      }
    });

    // --- CALLBACK QUERY HANDLER ---
    bot.on('callback_query', async (callbackQuery) => {
      const action = callbackQuery.data;
      const msg = callbackQuery.message;
      const chatId = msg.chat.id;

      const currentBot = await Bot.findById(botId);
      if (!currentBot || !currentBot.isActive) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "Bot is no longer active.", 
          show_alert: true 
        });
        return;
      }

      if (!currentBot.merchantChatId || !currentBot.mainGroupChatId) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "Bot is not properly configured.", 
          show_alert: true 
        });
        return;
      }

      const chatIdStr = String(chatId);
      const merchantChatIdStr = String(currentBot.merchantChatId);
      const mainGroupChatIdStr = String(currentBot.mainGroupChatId);
      
      const isMerchantChat = (chatIdStr === merchantChatIdStr);
      const isMainGroup = (chatIdStr === mainGroupChatIdStr);

      if (!isMerchantChat && !isMainGroup) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "Unauthorized chat.", 
          show_alert: true 
        });
        return;
      }

      const adminCheck = await checkAdminLimits(botId, chatId);
      if (!adminCheck.allowed) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "Daily limit reached! Please upgrade.", 
          show_alert: true 
        });
        return;
      }

      // Merchant panel interactions
      if (action.startsWith('mchk_')) {
        if (!isMerchantChat) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "This action is only available for merchants.", 
            show_alert: true 
          });
          return;
        }

        const parts = action.split('_'); 
        const status = parts[1];
        const customerChatId = parts[2];
        const customerMsgId = parts[3];

        const userMention = `<a href="tg://user?id=${customerChatId}">Customer</a>`;
        
        let alertText = "";
        let publicUpdateMessage = "";

        if (status === 'approve') {
          alertText = "Payment Approved!";
          publicUpdateMessage = `✅ <b>Payment Received Successfully!</b>\n\n📌 ${userMention}, your transaction has been audited and approved. Thank you!\n\n_This message is confirmed by the merchant, please do not reply._`;
          await currentBot.incrementUsage('transactions');
        } else if (status === 'reject') {
          alertText = "Payment Rejected!";
          publicUpdateMessage = `❌ <b>Deposit Slip Rejected!</b>\n\n📌 ${userMention}, the merchant team could not confirm this receipt. Please check your transaction details and resubmit.\n\n_This message has been processed by the merchant, please do not reply._`;
        } else if (status === 'custom') {
          bot.answerCallbackQuery(callbackQuery.id);
          
          await safeSendMessage(bot, currentBot.merchantChatId, 
            `✍️ <b>CUSTOM MESSAGE INPUT:</b>\nType your message below and press send. The bot will automatically deliver it to the user.\n\n` +
            `⚠️ Do not remove this system tracking tag:\n<code>[CID:${customerChatId}][MID:${customerMsgId}]</code>\n\n` +
            `💡 Tip: The message will appear as "Merchant Update" and the customer cannot reply directly.`
          );
          return;
        }

        await sendMerchantMessageToCustomer(bot, customerChatId, customerMsgId, publicUpdateMessage, true);

        try {
          await bot.answerCallbackQuery(callbackQuery.id, { text: alertText });

          const cleanCaption = msg.caption ? msg.caption.split('\n\n')[0] : "Transaction Processed";
          await bot.editMessageCaption(`${cleanCaption}\n\n⚡️ <b>STATUS LOGGED:</b> ${alertText}\n\n_This receipt has been processed, no further replies accepted._`, {
            chat_id: currentBot.merchantChatId,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: [] }
          });
        } catch (uiError) {
          console.error("❌ Merchant UI rendering exception:", uiError.message);
        }
        return;
      }

      // Bank selection
      if (action.startsWith('method_')) {
        if (!isMainGroup) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "Payment methods are only available in the authorized group.", 
            show_alert: true 
          });
          return;
        }

        const methodId = action.split('_')[1];
        try {
          let method = await PaymentMethod.findById(methodId);
          
          if (!method || !method.isActive) {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "Profile out of service.", 
              show_alert: true 
            });
            return;
          }
          
          if (method.botId && String(method.botId) !== String(botId)) {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "This payment method is not available for this bot.", 
              show_alert: true 
            });
            return;
          }

          await bot.answerCallbackQuery(callbackQuery.id);
          try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}

          let targetPayload = `🏛️ <b>${method.name} Transfer Data</b>\n` +
                              `👉 <b>REPLY TO THIS MESSAGE WITH RECEIPT PHOTO</b>\n` +
                              `⏳ <i>This record auto-destructs in 15 minutes.</i>\n\n` +
                              `• <b>Institution:</b> ${method.bankName}\n` +
                              `• <b>Account Holder:</b> <code>${method.accountName}</code>\n` +
                              `• <b>Account/Card Value:</b> <code>${method.accountNumber}</code>\n`;
          if (method.clabe) targetPayload += `• <b>CLABE Code:</b> <code>${method.clabe}</code>\n`;
          targetPayload += `\n📝 <b>Instructions:</b>\n${method.instructions}`;

          let dispatchedPackage;
          const targetAnchorId = msg.reply_to_message ? msg.reply_to_message.message_id : msg.message_id;

          if (method.qrCode && method.qrCode.trim() !== '') {
            try {
              const url = method.qrCode.trim();
              new URL(url);
              
              dispatchedPackage = await bot.sendPhoto(chatId, url, { 
                caption: targetPayload, 
                parse_mode: 'HTML', 
                reply_to_message_id: targetAnchorId 
              });
            } catch (photoError) {
              console.log('❌ QR Code send failed, sending text only:', photoError.message);
              dispatchedPackage = await safeSendMessage(bot, chatId, targetPayload);
            }
          } else {
            dispatchedPackage = await safeSendMessage(bot, chatId, targetPayload);
          }

          if (dispatchedPackage) {
            scheduleDeletion(bot, chatId, dispatchedPackage.message_id);
          }
        } catch (err) {
          console.error('❌ Callback exception:', err.message);
          try {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "Error loading payment method. Please try again.", 
              show_alert: true 
            });
          } catch (e) {}
        }
      }
    });

    return bot;
  } catch (err) {
    console.error(`❌ Failed to initialize bot ${botId}:`, err.message);
    await Bot.findByIdAndUpdate(botId, { isOnline: false });
    return null;
  }
};

// Helper: Safe send message with empty check
const safeSendMessage = async (bot, chatId, text, options = {}) => {
  if (!text || text.trim() === '') {
    console.log('⚠️ Attempted to send empty message, skipping');
    return null;
  }
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
  } catch (err) {
    console.error('❌ Failed to send message:', err.message);
    return null;
  }
};

// Helper: Safe send photo
const safeSendPhoto = async (bot, chatId, photo, options = {}) => {
  try {
    return await bot.sendPhoto(chatId, photo, options);
  } catch (err) {
    console.error('❌ Failed to send photo:', err.message);
    return null;
  }
};

// Stop a bot
const stopBot = async (botId) => {
  try {
    if (botInstances.has(botId)) {
      const bot = botInstances.get(botId);
      await bot.stopPolling();
      botInstances.delete(botId);
      await Bot.findByIdAndUpdate(botId, { isOnline: false });
      console.log(`✅ Bot ${botId} stopped successfully`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`❌ Failed to stop bot ${botId}:`, err.message);
    return false;
  }
};

// Initialize all active bots
const initAllBots = async () => {
  try {
    const bots = await Bot.find({ isActive: true });
    console.log(`📋 Found ${bots.length} active bots to initialize`);
    
    for (const bot of bots) {
      await initBot(bot.botToken, bot._id);
    }
  } catch (err) {
    console.error('Failed to initialize bots:', err);
  }
};

// Helper Functions
const scheduleDeletion = (bot, chatId, messageId, delayMs = 15 * 60 * 1000) => {
  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch (err) {
      // Safe catch
    }
  }, delayMs);
};

// MAIN MENU - Shows interactive buttons
const sendMainMenu = async (bot, chatId, text = "Use the interactive menu below:") => {
  const keyboard = {
    keyboard: [
      [{ text: "🏛️ Choose Payment Method" }],
      [{ text: "ℹ️ Help / How to Pay" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };

  try {
    await bot.sendMessage(chatId, text, {
      reply_markup: keyboard
    });
  } catch (err) {
    console.error("❌ Main menu error:", err.message);
  }
};

// BANK SELECTION - Shows inline buttons for payment methods
const sendBankSelection = async (bot, chatId, originalMessageId, botId) => {
  try {
    const methods = await PaymentMethod.find({ 
      botId: botId,
      isActive: true
    });
    
    if (methods.length === 0) {
      return safeSendMessage(bot, chatId, "❌ No active payment methods available for this bot.");
    }

    const inlineKeyboard = methods.map(method => [{
      text: `${method.name} (${method.bankName})`,
      callback_data: `method_${method._id}`
    }]);

    await bot.sendMessage(chatId, "Select a banking institution below:", {
      reply_to_message_id: originalMessageId,
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (err) {
    console.error("❌ Error fetching banks:", err.message);
    await safeSendMessage(bot, chatId, "❌ Error loading payment methods. Please try again.");
  }
};



// MERCHANT MESSAGE TO CUSTOMER
const sendMerchantMessageToCustomer = async (bot, customerChatId, customerMsgId, message, isFinal = true) => {
  try {
    const options = {
      reply_to_message_id: customerMsgId,
      parse_mode: 'HTML'
    };
    
    if (isFinal) {
      options.reply_markup = {
        keyboard: [
          [{ text: "🏛️ Choose Payment Method" }],
          [{ text: "ℹ️ Help / How to Pay" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };
    }
    
    const sentMsg = await bot.sendMessage(customerChatId, message, options);
    return sentMsg;
  } catch (err) {
    console.error('Send merchant message failed:', err.message);
    return null;
  }
};


module.exports = { initBot, stopBot, initAllBots, botInstances };