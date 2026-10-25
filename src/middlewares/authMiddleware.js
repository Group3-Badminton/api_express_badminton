const jwt = require('jsonwebtoken');
const User = require('../models/user');

// 1. Xác thực Token đăng nhập bắt buộc
exports.authenticateUser = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
    req.user = await User.findById(decoded.userId).select('-password');

    if (!req.user || req.user.status !== 'ACTIVE') {
      return res.status(401).json({ message: 'User not found or account is inactive' });
    }
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid Token' });
  }
};

// 2. Phân role truy cập trang (Hỗ trợ cả mảng hoặc chuỗi role)
exports.authorizeRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

// 3. Hàm chuyên check quyền Admin cho các thao tác CRUD (Tạo, Sửa, Xóa)
exports.checkAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden: Yêu cầu quyền Quản trị viên (Admin) để thao tác!' });
  }
  next();
};

// 4. Xác thực tùy chọn (dành cho API như Đặt sân: có token thì gán req.user, không có thì bỏ qua)
exports.optionalAuth = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'badminton_secret_key_2026');
      req.user = await User.findById(decoded.userId).select('-password');
      if (req.user && req.user.status !== 'ACTIVE') {
        req.authAccountBlocked = true;
        req.authAccountMessage =
          req.user.lockReason || 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!';
      }
    } catch (e) {
      // Bỏ qua lỗi token
    }
  }
  next();
};
