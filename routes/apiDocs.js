const express = require('express');
const router = express.Router();

// API Documentation
router.get('/', (req, res) => {
  res.json({
    name: 'PaymentBot API',
    version: '1.0.0',
    description: 'PaymentBot API Documentation',
    endpoints: {
      public: {
        'GET /api/methods/active': 'Get active payment methods'
      },
      admin: {
        'GET /admin/dashboard': 'Admin dashboard',
        'GET /admin/bots': 'List all bots',
        'POST /admin/bots': 'Create a bot',
        'PUT /admin/bots/:id': 'Update a bot',
        'DELETE /admin/bots/:id': 'Delete a bot',
        'GET /admin/plans': 'List all plans',
        'POST /admin/plans': 'Create a plan',
        'GET /admin/transactions': 'List all transactions',
        'GET /admin/transactions/:id': 'Get transaction details',
        'PUT /admin/transactions/:id': 'Update transaction status'
      }
    },
    authentication: 'JWT token required for admin endpoints'
  });
});

module.exports = router;