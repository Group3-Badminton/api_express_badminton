const User = require('../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendSuccess, sendError } = require('../utils/response');


exports.login = async (req, res) => {
  try {
    const { account, password } = req.body;

    // Lấy giá trị từ phone hoặc email
    const loginIdentifier = (account || '').trim().toLowerCase();

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

exports.register = async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;
    if (!fullName || !email || !phone || !password) {
      return sendError(res, 'Vui lòng nhập đầy đủ Họ tên, Email, Số điện thoại và Mật khẩu!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/;
    if (!phoneRegex.test(cleanPhone)) {
      return sendError(res, 'Số điện thoại không hợp lệ! Vui lòng nhập đúng số điện thoại (10 chữ số).', 400);
    }
    // 1. Kiểm tra Email (chặn nếu tài khoản đã tồn tại và không phải là CUSTOMER đang chờ xác thực OTP)
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      if (existingUser.role !== 'CUSTOMER' || existingUser.status !== 'PENDING_VERIFICATION') {
        return sendError(res, 'Email này đã được sử dụng. Vui lòng chọn email khác!', 400);
      }
    }
    // 2. Kiểm tra Số điện thoại
    const existingPhone = await User.findOne({ phone: cleanPhone, email: { $ne: cleanEmail } });
    if (existingPhone) {
      if (existingPhone.role !== 'CUSTOMER' || existingPhone.status !== 'PENDING_VERIFICATION') {
        return sendError(res, 'Số điện thoại này đã được sử dụng. Vui lòng chọn số khác!', 400);
      }
    }
    // 3. Sinh mã OTP và mã hóa mật khẩu
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const hashedPassword = await bcrypt.hash(password, 10);
    // 4. Nếu đã đăng ký trước đó nhưng chưa nhập OTP thì cập nhật lại thông tin mới
    if (existingUser) {
      existingUser.fullName = fullName.trim();
      existingUser.phone = cleanPhone;
      existingUser.password = hashedPassword;
      existingUser.resetOtp = otp;
      existingUser.resetOtpExpiry = otpExpiry;
      existingUser.status = 'PENDING_VERIFICATION';
      await existingUser.save();
    } else {
      // Tạo tài khoản mới ở trạng thái chờ xác thực
      await User.create({
        fullName: fullName.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        role: 'CUSTOMER',
        status: 'PENDING_VERIFICATION', // 👈 Chờ nhập OTP mới kích hoạt
        resetOtp: otp,
        resetOtpExpiry: otpExpiry
      });
    }
    // 5. Trả OTP về để Frontend dùng EmailJS gửi thư
    const userData = {
      email: cleanEmail,
      fullName: fullName.trim(),
      otp: otp
    };
    return sendSuccess(res, userData, 'Đã tạo tài khoản, vui lòng nhập mã OTP gửi về email để kích hoạt!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return sendError(res, 'Vui lòng nhập địa chỉ Email!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return sendError(res, "Email không tồn 400", 400);
    }
    if (user.status !== 'ACTIVE') {
      return sendError(res, 'Tài khoản của bạn đang bị khóa. Vui lòng liên hệ quản trị viên!', 403);
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000)

    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    const userData = {
      email: user.email,
      fullName: user.fullName,
      otp: otp
    }
    return sendSuccess(res, userData, 'Đã tạo mã OTP thành công!',
      200)
  } catch (error) {
    return sendError(res, error.message, 500);
  }
}

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return sendError(res, 'Vui lòng nhập đầy đủ Email và Mã OTP!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    const user = await User.findOne({
      email: cleanEmail,
      resetOtp: cleanOtp
    });
    if (!user) {
      return sendError(res, 'Mã OTP không chính xác!', 400);
    }
    if (new Date() > new Date(user.resetOtpExpiry)) {
      return sendError(res, 'Mã OTP đã hết hạn! Vui lòng yêu cầu mã mới.', 400);
    }
    // 👈 THÊM ĐOẠN NÀY: Nếu tài khoản mới đăng ký thì kích hoạt thành ACTIVE và xóa OTP
    if (user.status === 'PENDING_VERIFICATION') {
      user.status = 'ACTIVE';
      user.resetOtp = null;
      user.resetOtpExpiry = null;
      await user.save();
    }
    return sendSuccess(res, null, 'Xác thực OTP thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;
    // 1. Kiểm tra đầu vào
    if (!email || !otp || !newPassword) {
      return sendError(res, 'Vui lòng nhập đầy đủ thông tin!', 400);
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return sendError(res, 'Mật khẩu xác nhận không khớp!', 400);
    }
    if (newPassword.length < 6) {
      return sendError(res, 'Mật khẩu mới phải có tối thiểu 6 ký tự!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    const user = await User.findOne({
      email: cleanEmail,
      resetOtp: cleanOtp
    });
    if (!user) {
      return sendError(res, 'Mã xác thực không hợp lệ!', 400);
    }
    if (new Date() > new Date(user.resetOtpExpiry)) {
      return sendError(res, 'Mã OTP đã hết hạn! Vui lòng yêu cầu mã mới.', 400);
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();
    return sendSuccess(res, null, 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};