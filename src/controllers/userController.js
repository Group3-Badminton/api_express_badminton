const Staff = require('../models/staff');
const Customer = require('../models/customer');
const mongoose = require('mongoose');
const { sendSuccess, sendError } = require('../utils/response');

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    let user = null;
    if (req.userType === 'STAFF' || req.user.role === 'ADMIN' || req.user.role === 'STAFF') {
      user = await Staff.findById(userId).select('-password -resetOtp -resetOtpExpiry');
    } else {
      user = await Customer.findById(userId).select('-password -resetOtp -resetOtpExpiry');
    }

    if (!user) {
      return sendError(res, 'Không tìm thấy thông tin người dùng!', 404);
    }
    return sendSuccess(res, user, 'Lấy thông tin tài khoản thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 2. Cập nhật Họ tên, Email và Số điện thoại (UC-05 Profile)
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, email, phone } = req.body;
    const userId = req.user._id || req.user.userId;
    const isStaff = (req.userType === 'STAFF' || req.user.role === 'ADMIN' || req.user.role === 'STAFF');

    if (!fullName || !fullName.trim()) {
      return sendError(res, 'Vui lòng điền đầy đủ họ và tên.', 400);
    }

    const updateData = {
      fullName: fullName.trim()
    };

    // 1. Kiểm tra Email mới
    if (email !== undefined) {
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return sendError(res, 'Vui lòng nhập địa chỉ email hợp lệ.', 400);
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return sendError(res, 'Địa chỉ email không đúng định dạng. Vui lòng nhập lại.', 400);
      }

      // Kiểm tra Email trong cả 2 bảng (Staff & Customer)
      const staffEmail = isStaff
        ? await Staff.findOne({ email: cleanEmail, _id: { $ne: userId } })
        : await Staff.findOne({ email: cleanEmail });

      const custEmail = isStaff
        ? await Customer.findOne({ email: cleanEmail })
        : await Customer.findOne({ email: cleanEmail, _id: { $ne: userId } });

      if (staffEmail || custEmail) {
        return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 400);
      }
      updateData.email = cleanEmail;
    }

    // 2. Kiểm tra Số điện thoại mới
    if (phone !== undefined) {
      const cleanPhone = (phone || '').trim();
      if (!cleanPhone) {
        return sendError(res, 'Vui lòng nhập số điện thoại hợp lệ.', 400);
      }
      const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/;
      if (!phoneRegex.test(cleanPhone)) {
        return sendError(res, 'Số điện thoại không đúng định dạng (10 chữ số)!', 400);
      }

      // Kiểm tra SĐT trong cả 2 bảng (Staff & Customer)
      const staffPhone = isStaff
        ? await Staff.findOne({ phone: cleanPhone, _id: { $ne: userId } })
        : await Staff.findOne({ phone: cleanPhone });

      const custPhone = isStaff
        ? await Customer.findOne({ phone: cleanPhone })
        : await Customer.findOne({ phone: cleanPhone, _id: { $ne: userId } });

      if (staffPhone || custPhone) {
        return sendError(res, 'Số điện thoại này đã được sử dụng bởi tài khoản khác!', 400);
      }
      updateData.phone = cleanPhone;
    }

    let updatedUser = null;
    if (isStaff) {
      updatedUser = await Staff.findByIdAndUpdate(userId, updateData, { new: true }).select('-password -resetOtp -resetOtpExpiry');
    } else {
      updatedUser = await Customer.findByIdAndUpdate(userId, updateData, { new: true }).select('-password -resetOtp -resetOtpExpiry');
    }

    return sendSuccess(res, updatedUser, 'Thông tin hồ sơ của bạn đã được cập nhật thành công.', 200);
  } catch (error) {
    return sendError(res, 'Không thể cập nhật hồ sơ vào lúc này. Vui lòng thử lại sau.', 500);
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({})
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
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, status: 'LOCKED' },
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
            performedBy: req.user._id || req.user.userId
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
