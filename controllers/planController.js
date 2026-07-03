const Plan = require('../models/Plan');
const Bot = require('../models/Bot');

// Get all plans
exports.getPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ order: 1 });
    res.render('plans', { 
      plans, 
      adminData: req.admin,
      isSuperAdmin: req.admin.role === 'superadmin'
    });
  } catch (err) {
    console.error('Error loading plans:', err);
    res.status(500).send('Error loading plan management.');
  }
};

// Get single plan (API)
exports.getPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }
    res.json(plan);
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ error: 'Failed to fetch plan.' });
  }
};

// Create plan
exports.createPlan = async (req, res) => {
  try {
    const { 
      name, displayName, description, price, currency, interval,
      maxMessages, maxAdmins, maxPaymentMethods, maxGroups,
      features, settings, isActive, isPopular, badge, order
    } = req.body;

    // Check if plan name exists
    const existing = await Plan.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Plan name already exists.' });
    }

    const plan = new Plan({
      name,
      displayName,
      description: description || '',
      price,
      currency: currency || 'USD',
      interval: interval || 'monthly',
      maxMessages: maxMessages || 10,
      maxAdmins: maxAdmins || 1,
      maxPaymentMethods: maxPaymentMethods || 3,
      maxGroups: maxGroups || 1,
      features: features || {
        qrCodeSupport: true,
        customMessages: false,
        multiLanguage: false,
        analytics: false,
        exportData: false,
        prioritySupport: false,
        customBranding: false,
        apiAccess: false
      },
      settings: settings || {
        autoDeleteMessages: true,
        messageDeleteDelay: 15,
        requirePhoto: true,
        allowCustomAmount: false,
        maxFileSize: 20,
        allowedFileTypes: ['jpg', 'png', 'pdf']
      },
      isActive: isActive !== undefined ? isActive : true,
      isPopular: isPopular || false,
      badge: badge || '',
      order: order || 0,
      createdBy: req.admin.id
    });

    await plan.save();
    res.json({ success: true, message: 'Plan created successfully.', plan });
  } catch (err) {
    console.error('Create plan error:', err);
    res.status(500).json({ error: 'Failed to create plan.' });
  }
};

// Update plan
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, displayName, description, price, currency, interval,
      maxMessages, maxAdmins, maxPaymentMethods, maxGroups,
      features, settings, isActive, isPopular, badge, order
    } = req.body;

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    // Update fields
    if (name) plan.name = name;
    if (displayName) plan.displayName = displayName;
    if (description !== undefined) plan.description = description;
    if (price !== undefined) plan.price = price;
    if (currency) plan.currency = currency;
    if (interval) plan.interval = interval;
    if (maxMessages !== undefined) plan.maxMessages = maxMessages;
    if (maxAdmins !== undefined) plan.maxAdmins = maxAdmins;
    if (maxPaymentMethods !== undefined) plan.maxPaymentMethods = maxPaymentMethods;
    if (maxGroups !== undefined) plan.maxGroups = maxGroups;
    if (features) plan.features = { ...plan.features, ...features };
    if (settings) plan.settings = { ...plan.settings, ...settings };
    if (isActive !== undefined) plan.isActive = isActive;
    if (isPopular !== undefined) plan.isPopular = isPopular;
    if (badge !== undefined) plan.badge = badge;
    if (order !== undefined) plan.order = order;

    await plan.save();
    res.json({ success: true, message: 'Plan updated successfully.', plan });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan.' });
  }
};

// Delete plan
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    // Check if any bot is using this plan
    const botsUsingPlan = await Bot.countDocuments({ plan: plan.name });
    if (botsUsingPlan > 0) {
      return res.status(400).json({ 
        error: `Cannot delete plan. ${botsUsingPlan} bot(s) are currently using this plan.` 
      });
    }

    await Plan.findByIdAndDelete(id);
    res.json({ success: true, message: 'Plan deleted successfully.' });
  } catch (err) {
    console.error('Delete plan error:', err);
    res.status(500).json({ error: 'Failed to delete plan.' });
  }
};

// Seed default plans
exports.seedDefaultPlans = async (req, res) => {
  try {
    const defaultPlans = Plan.getDefaultPlans();
    let created = 0;
    let updated = 0;

    for (const planData of defaultPlans) {
      const existing = await Plan.findOne({ name: planData.name });
      if (existing) {
        // Update existing plan
        await Plan.findByIdAndUpdate(existing._id, planData);
        updated++;
      } else {
        // Create new plan
        const plan = new Plan(planData);
        await plan.save();
        created++;
      }
    }

    res.json({ 
      success: true, 
      message: `Default plans seeded successfully. Created: ${created}, Updated: ${updated}` 
    });
  } catch (err) {
    console.error('Seed default plans error:', err);
    res.status(500).json({ error: 'Failed to seed default plans.' });
  }
};

// Get plan comparison
exports.getPlanComparison = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.render('planComparison', { 
      plans, 
      adminData: req.admin,
      isSuperAdmin: req.admin.role === 'superadmin'
    });
  } catch (err) {
    console.error('Plan comparison error:', err);
    res.status(500).send('Error loading plan comparison.');
  }
};