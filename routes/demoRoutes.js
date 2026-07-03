const express = require('express');
const router = express.Router();
const demoController = require('../controllers/demoController');
const { auth } = require('../middleware/authMiddleware');

// Public demo routes
router.get('/setup', demoController.setupDemo);
router.get('/status', demoController.getDemoStatus);

// Protected demo routes
router.post('/reset', auth, demoController.resetDemo);

module.exports = router;