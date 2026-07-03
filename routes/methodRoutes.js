const express = require('express');
const router = express.Router();
const methodController = require('../controllers/methodController');
const { auth } = require('../middleware/authMiddleware');

// Public Bot consumption endpoint
router.get('/methods/active', methodController.getActiveMethods);

// Protected endpoints
router.get('/methods', auth, methodController.getAllMethods);
router.delete('/methods/:id', auth, methodController.deleteMethod);

module.exports = router;