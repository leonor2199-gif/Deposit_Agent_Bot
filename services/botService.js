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
      console.log(`ℹ️ 机器人 ${botId} 已在运行`);
      return botInstances.get(botId);
    }

    // Get bot data from database
    const botData = await Bot.findById(botId);
    if (!botData) {
      console.error(`❌ 数据库中未找到机器人 ${botId}`);
      return null;
    }

    if (!botData.isActive) {
      console.log(`ℹ️ 机器人 ${botData.name} 已停用，跳过初始化`);
      return null;
    }

    // Check if bot has required configuration
    if (!botData.merchantChatId || !botData.mainGroupChatId) {
      console.error(`❌ 机器人 ${botData.name} 缺少商户聊天ID或主群组聊天ID。机器人无法工作。`);
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

    console.log(`✅ 机器人 ${botData.name} (${botId}) 初始化成功`);
    console.log(`   📌 商户聊天ID: ${botData.merchantChatId}`);
    console.log(`   📌 主群组聊天ID: ${botData.mainGroupChatId}`);

    // Helper function to check admin limits
    const checkAdminLimits = async (botId, chatId) => {
      const admin = await Admin.findOne({ botId: botId });
      if (!admin) return { allowed: true };
      
      await admin.resetDailyCounter();
      
      if (!await admin.canSendMessage()) {
        return {
          allowed: false,
          message: `⚠️ <b>已达每日消息发送上限！</b>\n\n` +
                   `您今天已使用 ${admin.currentMessagesToday} 条消息，上限为 ${admin.maxMessagesPerDay === Infinity ? '∞' : admin.maxMessagesPerDay} 条。\n\n` +
                   `💎 <b>升级您的套餐</b>以获取无限消息发送权限。\n` +
                   `当前套餐：${admin.plan.toUpperCase()}\n\n` +
                   `请联系：${process.env.CONTACT_URL || 'support@your-site.com'}`
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
        await safeSendMessage(bot, chatId, '❌ 此机器人已停用。');
        return;
      }

      // Check if bot has required configuration
      if (!currentBot.merchantChatId || !currentBot.mainGroupChatId) {
        await safeSendMessage(bot, chatId, 
          '❌ 机器人配置不完整，请联系管理员。'
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
        console.log(`ℹ️ 未授权的聊天 ${chatIdStr} 尝试使用机器人 ${currentBot.name}`);
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
            `⚠️ <b>已达消息发送上限！</b>\n\n` +
            `您已使用 ${currentBot.currentMessages} 条消息，上限为 ${currentBot.maxMessages === Infinity ? '∞' : currentBot.maxMessages} 条。\n\n` +
            `💎 <b>升级您的套餐</b>以继续使用此机器人。\n` +
            `当前套餐：${currentBot.plan.toUpperCase()}\n\n` +
            `请联系：${process.env.CONTACT_URL || 'support@your-site.com'}`
          );
          return;
        }

        await currentBot.incrementUsage('messages');
      }

      // --- COMMAND HANDLING ---
      
      // START command - Show main menu with buttons
      if (text === '/start') {
        if (!isMainGroup && !isMerchantChat) return;
        return sendMainMenu(bot, chatId, "👋 欢迎使用支付管道系统！");
      }

      // HELP command
      if (text === 'ℹ️ 帮助 / 如何支付' || text === '/help') {
        if (!isMainGroup && !isMerchantChat) return;
        const helpMsg = `💡 <b>如何进行安全存款：</b>\n\n` +
                        `1️⃣ 点击 <b>🏛️ 选择支付方式</b>。\n` +
                        `2️⃣ 选择您的银行。\n` +
                        `3️⃣ <b>重要提示：</b>完成转账后，请<b>直接回复</b>该银行信息消息并附上您的收据照片！`;
        return safeSendMessage(bot, chatId, helpMsg);
      }

      // CHOOSE PAYMENT METHOD button
      if (text === '🏛️ 选择支付方式') {
        if (!isMainGroup) {
          await safeSendMessage(bot, chatId, 
            '❌ 支付方式仅在授权的群组中可用。'
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
            const parsedBankContext = originalBotMsg.text.split('\n')[0] || "活跃转账系统";

            if (isMainGroup) {
              const merchantCaption = `🚨 <b>收到新的存款凭证！</b>\n\n` +
                                      `👤 <b>发送账户：</b> ${userHandle} (ID: <code>${userId}</code>)\n` +
                                      `💵 <b>支付详情：</b> ${parsedBankContext}\n` +
                                      `📅 <b>时间戳：</b> ${new Date().toLocaleString()}\n\n` +
                                      `📌 <b>客户群组ID：</b> <code>${userChatId}</code>\n` +
                                      `📌 <b>客户消息ID：</b> <code>${msg.message_id}</code>\n` +
                                      `🤖 <b>机器人：</b> ${currentBot.name}`;

              try {
                await bot.sendPhoto(currentBot.merchantChatId, fileId, {
                  caption: merchantCaption,
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "确认 ✅", callback_data: `mchk_approve_${userChatId}_${msg.message_id}` },
                        { text: "拒绝 ❌", callback_data: `mchk_reject_${userChatId}_${msg.message_id}` }
                      ],
                      [
                        { text: "💬 自定义消息", callback_data: `mchk_custom_${userChatId}_${msg.message_id}` }
                      ]
                    ]
                  }
                });

                const confirmationMsg = await safeSendMessage(bot, chatId, `✅ 感谢您 ${userHandle}，您的收据已发送给商户团队！请等待确认。`);
                if (confirmationMsg) {
                  scheduleDeletion(bot, chatId, confirmationMsg.message_id, 60000);
                }
                
                await currentBot.incrementUsage('receipts');
              } catch (error) {
                console.error("❌ 转发收据失败：", error.message);
              }
            } else {
              await safeSendMessage(bot, chatId, 
                '❌ 请在授权的群组中使用此机器人。'
              );
            }
          }
        }
        return;
      }

      // Merchant custom message replies
      if (msg.reply_to_message && isMerchantChat) {
        const promptMsg = msg.reply_to_message;
        
        if (promptMsg.text && promptMsg.text.includes('✍️ 自定义消息输入：')) {
          try {
            const matchData = promptMsg.text.match(/\[CID:(.*?)\]\[MID:(.*?)\]/);
            if (!matchData) return;

            const customerChatId = matchData[1];
            const customerMsgId = matchData[2];

            const userMention = `<a href="tg://user?id=${customerChatId}">客户</a>`;
            const relayedMerchantText = `💬 <b>商户更新：</b>\n\n📌 ${userMention}，${text}\n\n_此消息来自商户，请勿回复。_`;

            await sendMerchantMessageToCustomer(bot, customerChatId, customerMsgId, relayedMerchantText, true);

            const successReceipt = await safeSendMessage(bot, currentBot.merchantChatId, `✅ 自定义通知已成功发送！`);
            if (successReceipt) {
              scheduleDeletion(bot, currentBot.merchantChatId, successReceipt.message_id, 5000);
            }
            
            bot.deleteMessage(currentBot.merchantChatId, promptMsg.message_id).catch(() => {});
            bot.deleteMessage(currentBot.merchantChatId, msg.message_id).catch(() => {});

          } catch (err) {
            console.error("❌ 转发商户自定义文本失败：", err.message);
          }
          return;
        }

        if (promptMsg.text && promptMsg.text.includes('商户更新：')) {
          const warningMsg = await safeSendMessage(bot, currentBot.merchantChatId, 
            '⚠️ 这是发送给客户的系统消息。请勿回复。请使用 "💬 自定义消息" 按钮联系客户。'
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
        if (repliedText && (repliedText.includes('商户更新：') || 
            repliedText.includes('支付成功接收') || 
            repliedText.includes('存款凭证已被拒绝'))) {
          const warningMsg = await safeSendMessage(bot, chatId, 
            'ℹ️ 这是来自商户的系统消息。请勿回复。如需帮助，请使用 "🏛️ 选择支付方式"。'
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
          text: "机器人已停用。", 
          show_alert: true 
        });
        return;
      }

      if (!currentBot.merchantChatId || !currentBot.mainGroupChatId) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "机器人配置不完整。", 
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
          text: "未授权的聊天。", 
          show_alert: true 
        });
        return;
      }

      const adminCheck = await checkAdminLimits(botId, chatId);
      if (!adminCheck.allowed) {
        await bot.answerCallbackQuery(callbackQuery.id, { 
          text: "已达每日上限！请升级套餐。", 
          show_alert: true 
        });
        return;
      }

      // Merchant panel interactions
      if (action.startsWith('mchk_')) {
        if (!isMerchantChat) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "此操作仅对商户可用。", 
            show_alert: true 
          });
          return;
        }

        const parts = action.split('_'); 
        const status = parts[1];
        const customerChatId = parts[2];
        const customerMsgId = parts[3];

        const userMention = `<a href="tg://user?id=${customerChatId}">客户</a>`;
        
        let alertText = "";
        let publicUpdateMessage = "";

        if (status === 'approve') {
          alertText = "支付已确认！";
          publicUpdateMessage = `✅ <b>支付成功接收！</b>\n\n📌 ${userMention}，您的交易已审核并确认。感谢您！\n\n_此消息由商户确认，请勿回复。_`;
          await currentBot.incrementUsage('transactions');
        } else if (status === 'reject') {
          alertText = "支付已拒绝！";
          publicUpdateMessage = `❌ <b>存款凭证已被拒绝！</b>\n\n📌 ${userMention}，商户团队无法确认此收据。请检查您的交易详情并重新提交。\n\n_此消息已由商户处理，请勿回复。_`;
        } else if (status === 'custom') {
          bot.answerCallbackQuery(callbackQuery.id);
          
          await safeSendMessage(bot, currentBot.merchantChatId, 
            `✍️ <b>自定义消息输入：</b>\n请在下方输入您的消息并发送。机器人将自动将其发送给用户。\n\n` +
            `⚠️ 请勿删除此系统跟踪标签：\n<code>[CID:${customerChatId}][MID:${customerMsgId}]</code>\n\n` +
            `💡 提示：消息将显示为"商户更新"，客户无法直接回复。`
          );
          return;
        }

        await sendMerchantMessageToCustomer(bot, customerChatId, customerMsgId, publicUpdateMessage, true);

        try {
          await bot.answerCallbackQuery(callbackQuery.id, { text: alertText });

          const cleanCaption = msg.caption ? msg.caption.split('\n\n')[0] : "交易已处理";
          await bot.editMessageCaption(`${cleanCaption}\n\n⚡️ <b>状态已记录：</b> ${alertText}\n\n_此收据已处理，不接受进一步回复。_`, {
            chat_id: currentBot.merchantChatId,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: [] }
          });
        } catch (uiError) {
          console.error("❌ 商户界面渲染异常：", uiError.message);
        }
        return;
      }

      // Bank selection
      if (action.startsWith('method_')) {
        if (!isMainGroup) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "支付方式仅在授权的群组中可用。", 
            show_alert: true 
          });
          return;
        }

        const methodId = action.split('_')[1];
        try {
          let method = await PaymentMethod.findById(methodId);
          
          if (!method || !method.isActive) {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "该支付方式已停用。", 
              show_alert: true 
            });
            return;
          }
          
          if (method.botId && String(method.botId) !== String(botId)) {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "此支付方式不适用于此机器人。", 
              show_alert: true 
            });
            return;
          }

          await bot.answerCallbackQuery(callbackQuery.id);
          try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}

          let targetPayload = `🏛️ <b>${method.name} 转账信息</b>\n` +
                              `👉 <b>请回复此消息并附上收据照片</b>\n` +
                              `⏳ <i>此记录将在15分钟后自动删除。</i>\n\n` +
                              `• <b>机构：</b> ${method.bankName}\n` +
                              `• <b>账户持有人：</b> <code>${method.accountName}</code>\n` +
                              `• <b>账号/卡号：</b> <code>${method.accountNumber}</code>\n`;
          if (method.clabe) targetPayload += `• <b>CLABE代码：</b> <code>${method.clabe}</code>\n`;
          targetPayload += `\n📝 <b>操作说明：</b>\n${method.instructions}`;

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
              console.log('❌ 发送二维码失败，仅发送文本：', photoError.message);
              dispatchedPackage = await safeSendMessage(bot, chatId, targetPayload);
            }
          } else {
            dispatchedPackage = await safeSendMessage(bot, chatId, targetPayload);
          }

          if (dispatchedPackage) {
            scheduleDeletion(bot, chatId, dispatchedPackage.message_id);
          }
        } catch (err) {
          console.error('❌ 回调异常：', err.message);
          try {
            await bot.answerCallbackQuery(callbackQuery.id, { 
              text: "加载支付方式出错。请重试。", 
              show_alert: true 
            });
          } catch (e) {}
        }
      }
    });

    return bot;
  } catch (err) {
    console.error(`❌ 初始化机器人 ${botId} 失败：`, err.message);
    await Bot.findByIdAndUpdate(botId, { isOnline: false });
    return null;
  }
};

// Helper: Safe send message with empty check
const safeSendMessage = async (bot, chatId, text, options = {}) => {
  if (!text || text.trim() === '') {
    console.log('⚠️ 尝试发送空消息，已跳过');
    return null;
  }
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...options });
  } catch (err) {
    console.error('❌ 发送消息失败：', err.message);
    return null;
  }
};

// Helper: Safe send photo
const safeSendPhoto = async (bot, chatId, photo, options = {}) => {
  try {
    return await bot.sendPhoto(chatId, photo, options);
  } catch (err) {
    console.error('❌ 发送照片失败：', err.message);
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
      console.log(`✅ 机器人 ${botId} 已成功停止`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`❌ 停止机器人 ${botId} 失败：`, err.message);
    return false;
  }
};

// Initialize all active bots
const initAllBots = async () => {
  try {
    const bots = await Bot.find({ isActive: true });
    console.log(`📋 找到 ${bots.length} 个活跃机器人待初始化`);
    
    for (const bot of bots) {
      await initBot(bot.botToken, bot._id);
    }
  } catch (err) {
    console.error('初始化机器人失败：', err);
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
const sendMainMenu = async (bot, chatId, text = "请使用以下交互菜单：") => {
  const keyboard = {
    keyboard: [
      [{ text: "🏛️ 选择支付方式" }],
      [{ text: "ℹ️ 帮助 / 如何支付" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };

  try {
    await bot.sendMessage(chatId, text, {
      reply_markup: keyboard
    });
  } catch (err) {
    console.error("❌ 主菜单错误：", err.message);
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
      return safeSendMessage(bot, chatId, "❌ 此机器人暂无可用支付方式。");
    }

    const inlineKeyboard = methods.map(method => [{
      text: `${method.name} (${method.bankName})`,
      callback_data: `method_${method._id}`
    }]);

    await bot.sendMessage(chatId, "请选择以下银行机构：", {
      reply_to_message_id: originalMessageId,
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (err) {
    console.error("❌ 获取银行列表失败：", err.message);
    await safeSendMessage(bot, chatId, "❌ 加载支付方式失败。请重试。");
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
          [{ text: "🏛️ 选择支付方式" }],
          [{ text: "ℹ️ 帮助 / 如何支付" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };
    }
    
    const sentMsg = await bot.sendMessage(customerChatId, message, options);
    return sentMsg;
  } catch (err) {
    console.error('发送商户消息失败：', err.message);
    return null;
  }
};

module.exports = { initBot, stopBot, initAllBots, botInstances };
