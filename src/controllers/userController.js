const User = require('../models/user');
const mongoose = require('mongoose');
const { sendSuccess, sendError } = require('../utils/response');

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

// 2. Cập nhật Họ tên và Email (UC-05: SĐT là định danh duy nhất - chỉ đọc)
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const userId = req.user.userId;

    if (!fullName || !fullName.trim()) {
      return sendError(res, 'Vui lòng điền đầy đủ tất cả các trường bắt buộc.', 400);
    }

    const updateData = {
      fullName: fullName.trim()
    };

    if (email !== undefined) {
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return sendError(res, 'Vui lòng điền đầy đủ tất cả các trường bắt buộc.', 400);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return sendError(res, 'Địa chỉ email không đúng định dạng. Vui lòng nhập lại.', 400);
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

    return sendSuccess(res, updatedUser, 'Thông tin hồ sơ của bạn đã được cập nhật thành công.', 200);
  } catch (error) {
    return sendError(res, 'Không thể cập nhật hồ sơ vào lúc này. Vui lòng thử lại sau.', 500);
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const customers = await User.find({ role: 'CUSTOMER' })
      .select('_id fullName email phone status lockReason lockedAt lockedByBookingId bookingCancellationHistory accountLockHistory createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    return sendSuccess(res, customers, 'Lấy danh sách khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.unlockCustomer = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendError(res, 'Không tìm thấy tài khoản khách hàng!', 404);
    }
    const unlockedAt = new Date();
    const customer = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'CUSTOMER', status: 'LOCKED' },
      {
        $set: {
          status: 'ACTIVE',
          lockReason: '',
          lockedAt: null,
          lockedByBookingId: null
        },
        $push: {
          accountLockHistory: {
            action: 'UNLOCKED',
            reason: 'Admin mở khóa tài khoản.',
            occurredAt: unlockedAt,
            performedBy: req.user.userId
          }
        }
      },
      { returnDocument: 'after', runValidators: true }
    )
      .select('_id fullName email phone status lockReason lockedAt lockedByBookingId bookingCancellationHistory accountLockHistory createdAt updatedAt')
      .lean();
    if (!customer) {
      return sendError(res, 'Tài khoản khách hàng không tồn tại hoặc không ở trạng thái bị khóa.', 409);
    }
    return sendSuccess(res, customer, 'Mở khóa tài khoản khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};