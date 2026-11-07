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

// Phân quyền theo role ('ADMIN', 'STAFF', 'CUSTOMER')
const authorizeRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

// Bắt buộc đăng nhập với vai trò Staff (bao gồm Staff & Admin)
const requireStaff = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
    const userId = decoded.userId || decoded.id;
    const staff = await Staff.findById(userId).select('-password');

    if (!staff || staff.status !== 'ACTIVE') {
      return res.status(401).json({ message: 'Staff not found or account is inactive' });
    }

    req.user = staff;
    req.staff = staff;
    req.userType = 'STAFF';
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid Token' });
  }
};

// Bắt buộc quyền Quản trị viên (ADMIN trong bảng Staff)
const checkAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden: Yêu cầu quyền Quản trị viên (Admin) để thao tác!' });
  }
  next();
};

// Bắt buộc đăng nhập với vai trò Customer
const requireCustomer = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
    const userId = decoded.userId || decoded.id;
    const customer = await Customer.findById(userId).select('-password');

    if (!customer || customer.status !== 'ACTIVE') {
      return res.status(401).json({
        message: customer && customer.lockReason ? customer.lockReason : 'Customer not found or account is inactive'
      });
    }

    req.user = customer;
    req.customer = customer;
    req.userType = 'CUSTOMER';
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid Token' });
  }
};

// Xác thực tùy chọn (dành cho các endpoint khách vãng lai hoặc đã đăng nhập)
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
      // Bỏ qua lỗi token khi optional
    }
  }
  next();
};

module.exports = authenticateUser;
module.exports.authenticateUser = authenticateUser;
module.exports.authorizeRole = authorizeRole;
module.exports.checkAdmin = checkAdmin;
module.exports.requireStaff = requireStaff;
module.exports.requireCustomer = requireCustomer;
module.exports.optionalAuth = optionalAuth;
