const jwt = require('jsonwebtoken');
const User = require('../models/user');
const { sendError } = require('../utils/response');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Vui lòng đăng nhập để thực hiện chức năng này!', 401);
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'badminton_secret_key_2026'
      );
    } catch (err) {
      return sendError(res, 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại!', 401);
    }

    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      return sendError(res, 'Tài khoản người dùng không tồn tại hoặc đã bị xóa!', 401);
    }

    if (currentUser.status !== 'ACTIVE') {
      return sendError(res, 'Tài khoản của bạn đã bị vô hiệu hóa hoặc bị khóa. Vui lòng liên hệ quản trị viên!', 403);
    }

    req.user = {
      userId: currentUser._id.toString(),
      _id: currentUser._id,
      email: currentUser.email,
      fullName: currentUser.fullName,
      phone: currentUser.phone,
      role: currentUser.role,
      status: currentUser.status
    };

    next();
  } catch (error) {
    return sendError(res, error.message || 'Lỗi xác thực hệ thống!', 500);
  }
};