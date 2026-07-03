const jwt = require('jsonwebtoken');

// Check if user is authenticated
const auth = (req, res, next) => {
  const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized. Access Denied.' });
    }
    return res.redirect('/admin/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Token is invalid or expired.' });
    }
    return res.redirect('/admin/login');
  }
};

// Check if user is superadmin
const isSuperAdmin = (req, res, next) => {
  if (req.admin.role !== 'superadmin') {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Superadmin access required.' });
    }
    return res.status(403).send('Access Denied. Superadmin privileges required.');
  }
  next();
};

// Check if user has access to specific group
const hasGroupAccess = (req, res, next) => {
  const { groupId } = req.params;
  // Superadmin has access to all
  if (req.admin.role === 'superadmin') return next();
  
  // Check if admin has access to this group
  // This will be checked in controller
  req.groupAccessCheck = true;
  next();
};

module.exports = { auth, isSuperAdmin, hasGroupAccess };