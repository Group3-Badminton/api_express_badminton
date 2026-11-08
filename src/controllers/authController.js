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

    // Nếu tài khoản tại quầy chưa được thiết lập mật khẩu online
    if (!user.password) {
      return sendError(
        res,
        'Tài khoản này được tạo tại quầy và chưa kích hoạt mật khẩu Online. Vui lòng bấm "Đăng ký" bằng số điện thoại này để thiết lập mật khẩu!',
        400
      );
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

    // 1. Kiểm tra Email có bị trùng với Staff không
    const staffEmailExists = await Staff.findOne({ email: cleanEmail });
    if (staffEmailExists) {
      return sendError(res, 'Email này đã được sử dụng. Vui lòng chọn email khác!', 400);
    }

    // 2. Kiểm tra Số điện thoại có bị trùng với Staff không
    const staffPhoneExists = await Staff.findOne({ phone: cleanPhone });
    if (staffPhoneExists) {
      return sendError(res, 'Số điện thoại này đã được đăng ký. Vui lòng đăng nhập hoặc sử dụng số khác.', 400);
    }

    // 3. Kiểm tra khách hàng theo Số điện thoại hoặc Email
    const existingByPhone = await Customer.findOne({ phone: cleanPhone });
    const existingByEmail = await Customer.findOne({ email: cleanEmail });

    // Nếu email đã được tài khoản khác (khác SĐT này) sử dụng và tài khoản đó đã có mật khẩu hoặc đang active
    if (existingByEmail && existingByPhone && existingByEmail._id.toString() !== existingByPhone._id.toString()) {
      if (existingByEmail.password || existingByEmail.status !== 'PENDING_VERIFICATION') {
        return sendError(res, 'Email này đã được sử dụng bởi tài khoản khác. Vui lòng chọn email khác!', 400);
      }
    } else if (existingByEmail && !existingByPhone) {
      if (existingByEmail.password || existingByEmail.status !== 'PENDING_VERIFICATION') {
        return sendError(res, 'Email này đã được sử dụng. Vui lòng chọn email khác!', 400);
      }
    }

    // Nếu SĐT đã có tài khoản trực tuyến (đã có password)
    if (existingByPhone && existingByPhone.password && existingByPhone.status !== 'PENDING_VERIFICATION') {
      return sendError(res, 'Số điện thoại này đã được đăng ký tài khoản online. Vui lòng đăng nhập hoặc chọn Quên mật khẩu.', 400);
    }

    // 4. Sinh mã OTP và mã hóa mật khẩu
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Nâng cấp tài khoản khách vãng lai (Admin tạo tại quầy) hoặc tạo mới
    const targetCustomer = existingByPhone || existingByEmail;
    if (targetCustomer) {
      // Cập nhật thông tin online vào hồ sơ đã có sẵn của khách
      targetCustomer.fullName = fullName.trim() || targetCustomer.fullName;
      targetCustomer.email = cleanEmail;
      targetCustomer.phone = cleanPhone;
      targetCustomer.password = hashedPassword;
      targetCustomer.resetOtp = otp;
      targetCustomer.resetOtpExpiry = otpExpiry;
      // Đánh dấu chờ xác thực OTP kích hoạt tài khoản
      targetCustomer.status = 'PENDING_VERIFICATION';
      await targetCustomer.save();
    } else {
      // Tạo mới hoàn toàn
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
      otp: otp,
      otpExpiry: otpExpiry
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
    if (user.status === 'PENDING_VERIFICATION') {
      return sendError(
        res,
        'Tài khoản này chưa được kích hoạt. Vui lòng hoàn tất kích hoạt tài khoản hoặc đăng ký lại!',
        400
      );
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
