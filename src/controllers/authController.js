const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendSuccess, sendError } = require('../utils/response');

// Đăng nhập tài khoản (Hỗ trợ cả Email & Số điện thoại)
exports.login = async (req, res) => {
  try {
    const { account, email, password } = req.body;
    
    // Lấy giá trị từ account hoặc email
    const loginIdentifier = (account || email || '').trim().toLowerCase();

    // 1. Kiểm tra đầu vào
    if (!loginIdentifier || !password) {
      return sendError(res, 'Vui lòng nhập đầy đủ Email/Số điện thoại và Mật khẩu!', 400);
    }

    // 2. Tìm user trong MongoDB theo Email HOẶC Số điện thoại
    const user = await User.findOne({
      $or: [
        { email: loginIdentifier },
        { phone: loginIdentifier }
      ]
    });

    if (!user) {
      return sendError(res, 'Tài khoản hoặc mật khẩu không chính xác!', 401);
    }

    // 3. Kiểm tra mật khẩu đã mã hóa bằng bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendError(res, 'Tài khoản hoặc mật khẩu không chính xác!', 401);
    }

    // 4. Kiểm tra tài khoản có bị khóa không
    if (user.status !== 'ACTIVE') {
      return sendError(res, 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên!', 403);
    }

    // 5. Tạo chuỗi Token JWT (hạn dùng 7 ngày)
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET || 'badminton_secret_key_2026',
      { expiresIn: '3h' }
    );

    // 6. Trả dữ liệu về Frontend
    const userData = {
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      status: user.status
    };

    return sendSuccess(res, { user: userData, token }, 'Đăng nhập thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};