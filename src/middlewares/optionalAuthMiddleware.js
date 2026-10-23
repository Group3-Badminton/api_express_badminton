const jwt = require('jsonwebtoken');
const User = require('../models/user');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || 'badminton_secret_key_2026'
        );
        const currentUser = await User.findById(decoded.userId);
        if (currentUser && currentUser.status === 'ACTIVE') {
          req.user = {
            userId: currentUser._id.toString(),
            _id: currentUser._id,
            email: currentUser.email,
            fullName: currentUser.fullName,
            phone: currentUser.phone,
            role: currentUser.role,
            status: currentUser.status
          };
        } else if (currentUser && currentUser.status !== 'ACTIVE') {
          req.authAccountBlocked = true;
          req.authAccountMessage = currentUser.lockReason ||
            'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!';
        }
      } catch (err) {
        // Token không hợp lệ thì coi như khách chưa đăng nhập
      }
    }
    next();
  } catch (error) {
    next();
  }
};
