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

// 2. Cập nhật Họ tên và Số điện thoại
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    const userId = req.user.userId;

    if (!fullName || !fullName.trim()) {
      return sendError(res, 'Họ và tên không được để trống!', 400);
    }

    const cleanPhone = (phone || '').trim();
    if (cleanPhone) {
      const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/;
      if (!phoneRegex.test(cleanPhone)) {
        return sendError(res, 'Số điện thoại không hợp lệ (phải gồm 10 chữ số)!', 400);
      }

      // Kiểm tra xem số điện thoại có bị trùng với tài khoản khác không
      const existingPhone = await User.findOne({
        phone: cleanPhone,
        _id: { $ne: userId }
      });

      if (existingPhone) {
        return sendError(res, 'Số điện thoại này đã được sử dụng bởi tài khoản khác!', 400);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        fullName: fullName.trim(),
        phone: cleanPhone
      },
      { new: true }
    ).select('-password -resetOtp -resetOtpExpiry');

    return sendSuccess(res, updatedUser, 'Cập nhật thông tin cá nhân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
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