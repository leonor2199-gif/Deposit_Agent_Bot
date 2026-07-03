const axios = require('axios');
const crypto = require('crypto');

// Store webhook subscriptions
const webhookSubscriptions = new Map();

// Register a webhook
exports.registerWebhook = (botId, url, events, secret) => {
  const subscription = {
    url,
    events: events || ['*'],
    secret: secret || crypto.randomBytes(32).toString('hex'),
    active: true,
    createdAt: new Date()
  };
  
  if (!webhookSubscriptions.has(botId)) {
    webhookSubscriptions.set(botId, []);
  }
  webhookSubscriptions.get(botId).push(subscription);
  
  return subscription;
};

// Unregister a webhook
exports.unregisterWebhook = (botId, url) => {
  if (webhookSubscriptions.has(botId)) {
    const subscriptions = webhookSubscriptions.get(botId);
    const index = subscriptions.findIndex(s => s.url === url);
    if (index > -1) {
      subscriptions.splice(index, 1);
      return true;
    }
  }
  return false;
};

// Send webhook event
exports.sendWebhook = async (botId, event, data) => {
  if (!webhookSubscriptions.has(botId)) {
    return;
  }
  
  const subscriptions = webhookSubscriptions.get(botId);
  const activeSubscriptions = subscriptions.filter(s => s.active);
  
  for (const sub of activeSubscriptions) {
    // Check if event matches
    if (!sub.events.includes('*') && !sub.events.includes(event)) {
      continue;
    }
    
    try {
      const payload = {
        event,
        botId,
        data,
        timestamp: new Date().toISOString()
      };
      
      // Sign the payload
      const signature = crypto
        .createHmac('sha256', sub.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      await axios.post(sub.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature
        },
        timeout: 5000
      });
      
      console.log(`✅ Webhook sent to ${sub.url} for event ${event}`);
    } catch (err) {
      console.error(`❌ Webhook failed for ${sub.url}:`, err.message);
      
      // Retry logic could be implemented here
      // Mark as failed and retry later
    }
  }
};

// Webhook events
exports.EVENTS = {
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_APPROVED: 'transaction.approved',
  TRANSACTION_REJECTED: 'transaction.rejected',
  TRANSACTION_COMPLETED: 'transaction.completed',
  BOT_STARTED: 'bot.started',
  BOT_STOPPED: 'bot.stopped',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_FAILED: 'payment.failed'
};