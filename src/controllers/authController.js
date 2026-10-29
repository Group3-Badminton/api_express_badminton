const Staff = require('../models/staff');
const Customer = require('../models/customer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendSuccess, sendError } = require('../utils/response');

exports.login = async (req, res) => {
  try {
    const { account, password } = req.body;
    const loginIdentifier = (account || '').trim().toLowerCase();

    if (!loginIdentifier || !password) {
      return sendError(res, 'Vui lòng nhập đầy đủ Email/Số điện thoại và Mật khẩu!', 400);
    }

    // 1. Tìm trong bảng Staff (Admin/Staff) trước
    let user = await Staff.findOne({
      $or: [
        { email: loginIdentifier },
        { phone: loginIdentifier }
      ]
    });
    let userType = 'STAFF';

    // 2. Nếu không có trong Staff, tìm trong bảng Customer
    if (!user) {
      user = await Customer.findOne({
        $or: [
          { email: loginIdentifier },
          { phone: loginIdentifier }
        ]
      });
      userType = 'CUSTOMER';
    }

    if (!user) {
      return sendError(res, 'Tài khoản hoặc mật khẩu không chính xác!', 401);
    }

    // 3. Kiểm tra mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendError(res, 'Tài khoản hoặc mật khẩu không chính xác!', 401);
    }

    // 4. Kiểm tra trạng thái tài khoản
    if (user.status !== 'ACTIVE') {
      return sendError(
        res,
        user.lockReason || 'Tài khoản của bạn đang bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
        403
      );
    }

    // 5. Tạo JWT Token kèm thông tin userType và role
    const token = jwt.sign(
      { userId: user._id, role: user.role, email: user.email, userType },
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
      status: user.status,
      userType
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

    // 1. Kiểm tra Email xem có bị trùng trong Staff hoặc Customer không
    const staffEmailExists = await Staff.findOne({ email: cleanEmail });
    if (staffEmailExists) {
      return sendError(res, 'Email này đã được sử dụng. Vui lòng chọn email khác!', 400);
    }

    const existingCustomer = await Customer.findOne({ email: cleanEmail });
    if (existingCustomer && existingCustomer.status !== 'PENDING_VERIFICATION') {
      return sendError(res, 'Email này đã được sử dụng. Vui lòng chọn email khác!', 400);
    }

    // 2. Kiểm tra Số điện thoại
    const staffPhoneExists = await Staff.findOne({ phone: cleanPhone });
    if (staffPhoneExists) {
      return sendError(res, 'Số điện thoại này đã được đăng ký. Vui lòng đăng nhập hoặc sử dụng số khác.', 400);
    }

    const existingPhone = await Customer.findOne({ phone: cleanPhone, email: { $ne: cleanEmail } });
    if (existingPhone && existingPhone.status !== 'PENDING_VERIFICATION') {
      return sendError(res, 'Số điện thoại này đã được đăng ký. Vui lòng đăng nhập hoặc sử dụng số khác.', 400);
    }

    // 3. Sinh mã OTP và mã hóa mật khẩu
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Cập nhật nếu đang ở PENDING_VERIFICATION hoặc tạo mới
    if (existingCustomer) {
      existingCustomer.fullName = fullName.trim();
      existingCustomer.phone = cleanPhone;
      existingCustomer.password = hashedPassword;
      existingCustomer.resetOtp = otp;
      existingCustomer.resetOtpExpiry = otpExpiry;
      existingCustomer.status = 'PENDING_VERIFICATION';
      await existingCustomer.save();
    } else {
      await Customer.create({
        fullName: fullName.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        role: 'CUSTOMER',
        status: 'PENDING_VERIFICATION',
        resetOtp: otp,
        resetOtpExpiry: otpExpiry
      });
    }

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
    const { email } = req.body;
    if (!email) {
      return sendError(res, 'Vui lòng nhập địa chỉ Email!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();

    // Tìm trong Staff hoặc Customer
    let user = await Staff.findOne({ email: cleanEmail });
    if (!user) {
      user = await Customer.findOne({ email: cleanEmail });
    }

    if (!user) {
      return sendError(res, 'Không tìm thấy tài khoản nào liên kết với email này.', 404);
    }
    if (user.status !== 'ACTIVE') {
      return sendError(res, 'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.', 403);
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry;
    await user.save();

    const userData = {
      email: user.email,
      fullName: user.fullName,
      otp: otp
    };
    return sendSuccess(res, userData, 'Đã tạo mã OTP thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return sendError(res, 'Vui lòng nhập đầy đủ Email và Mã OTP!', 400);
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    let user = await Staff.findOne({ email: cleanEmail, resetOtp: cleanOtp });
    if (!user) {
      user = await Customer.findOne({ email: cleanEmail, resetOtp: cleanOtp });
    }

    if (!user) {
      return sendError(res, 'Mã OTP không chính xác!', 400);
    }
    if (new Date() > new Date(user.resetOtpExpiry)) {
      return sendError(res, 'Mã OTP đã hết hạn! Vui lòng yêu cầu mã mới.', 400);
    }

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

    let user = await Staff.findOne({ email: cleanEmail, resetOtp: cleanOtp });
    if (!user) {
      user = await Customer.findOne({ email: cleanEmail, resetOtp: cleanOtp });
    }

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
