const User = require('../models/user');
const { sendSuccess, sendError } = require('../utils/response');

// 1. Lấy thông tin tài khoản hiện tại (UC-5.1 & UC-5.3)
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -resetOtp -resetOtpExpiry');
    if (!user) {
      return sendError(res, 'Không tìm thấy thông tin người dùng!', 404);
    }
    return sendSuccess(res, user, 'Lấy thông tin tài khoản thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 2. Cập nhật Họ tên và Email (UC-5.2 & UC-5.4)
// Quy tắc BR-04 & BR-05: Số điện thoại là định danh tài khoản duy nhất và hiển thị dạng chỉ đọc (Read-only), không được thay đổi.
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const userId = req.user.userId;

    if (!fullName || !fullName.trim()) {
      return sendError(res, 'Họ và tên không được để trống!', 400);
    }

    const cleanFullName = fullName.trim();
    const updateData = { fullName: cleanFullName };

    // Xử lý cập nhật Email
    if (email !== undefined) {
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return sendError(res, 'Email không được để trống!', 400);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return sendError(res, 'Email không đúng định dạng hợp lệ!', 400);
      }

      // Kiểm tra xem email có bị trùng với tài khoản khác không
      const existingEmail = await User.findOne({
        email: cleanEmail,
        _id: { $ne: userId }
      });

      if (existingEmail) {
        return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 400);
      }

      updateData.email = cleanEmail;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password -resetOtp -resetOtpExpiry');

    return sendSuccess(res, updatedUser, 'Cập nhật thông tin cá nhân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};
