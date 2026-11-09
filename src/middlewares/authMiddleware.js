const jwt = require('jsonwebtoken');
const Staff = require('../models/staff');
const Customer = require('../models/customer');

// Xác thực bất kỳ người dùng đã đăng nhập (Staff hoặc Customer)
const authenticateUser = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
    const userId = decoded.userId || decoded.id;

    // Tìm trong Staff trước hoặc Customer
    let account = null;
    let userType = decoded.userType;

    if (userType === 'STAFF') {
      account = await Staff.findById(userId).select('-password');
    } else if (userType === 'CUSTOMER') {
      account = await Customer.findById(userId).select('-password');
    } else {
      // Tương thích ngược: kiểm tra Staff rồi Customer
      account = await Staff.findById(userId).select('-password');
      if (account) {
        userType = 'STAFF';
      } else {
        account = await Customer.findById(userId).select('-password');
        if (account) userType = 'CUSTOMER';
      }
    }

    if (!account) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (account.status !== 'ACTIVE') {
      return res.status(403).json({
        message: account && account.lockReason ? account.lockReason : 'Tài khoản của bạn đã bị vô hiệu hóa hoặc bị khóa.'
      });
    }

    req.user = account;
    req.userType = userType;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid Token' });
  }
};

const authorizeRole = (...roles) => {
  const allowedRoles = roles.flat();
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: Bạn không có quyền thực hiện thao tác này!' });
    }
    next();
  };
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
      const userId = decoded.userId || decoded.id;
      let account = await Staff.findById(userId).select('-password');
      if (account) {
        req.userType = 'STAFF';
      } else {
        account = await Customer.findById(userId).select('-password');
        if (account) req.userType = 'CUSTOMER';
      }

      if (account) {
        req.user = account;
        if (account.status !== 'ACTIVE') {
          req.authAccountBlocked = true;
          req.authAccountMessage =
            account.lockReason || 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!';
        }
      }
    } catch (e) {
      
    }
  }
  next();
};

module.exports = {
  authenticateUser,
  authorizeRole,
  optionalAuth
};
