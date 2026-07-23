const Admin = require("../models/Admin");

async function createSuperAdmin() {
  try {
    const existing = await Admin.findOne({ role: "superadmin" });

    if (existing) {
      console.log("✅ Super Admin already exists");
      return;
    }

    await Admin.create({
      username: "superadmin",
      password: "xerlok2222",
      email: "xerlokxerlok322@gmail.com",

      role: "superadmin",

      plan: "enterprise",

      maxBots: Infinity,
      maxMessagesPerDay: Infinity,
      maxMessages: Infinity,
      maxAdmins: Infinity,
      maxPaymentMethods: Infinity,
      maxGroups: Infinity,

      canManageAllGroups: true,
      canManageAllBots: true,

      features: {
        canManageAdmins: true,
        canManageBots: true,
        canManagePaymentMethods: true,
        canManageGroups: true,
        canManagePlans: true,
        canManageTransactions: true,
        canViewAnalytics: true,
        canExportData: true,
        canAccessAPI: true,
        canManageWebhooks: true,
      },

      isSubscriptionActive: true,
      isActive: true,
    });

    console.log("🎉 Super Admin created successfully");
  } catch (err) {
    console.error("❌ Failed to create Super Admin:", err);
  }
}

module.exports = createSuperAdmin;
