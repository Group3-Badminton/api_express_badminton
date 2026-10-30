const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Staff = require('../models/staff');
const Customer = require('../models/customer');
const { sendSuccess, sendError } = require('../utils/response');

const PHONE_REGEX = /^0[35789][0-9]{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeStaff = (staff) => ({
  _id: staff._id,
  fullName: staff.fullName,
  email: staff.email,
  phone: staff.phone,
  role: staff.role,
  status: staff.status,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt
});

const ALLOWED_STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING_VERIFICATION'];
const MAX_SEARCH_LENGTH = 100;

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * UC-8.1 — View Staff List & UC-8.6 — Search/Filter Staff
 * Actor: Admin (ACTIVE)
 */
exports.getStaffs = async (req, res) => {
  const isSearchOrFilter = req.query.search !== undefined || req.query.status !== undefined;
  try {
    const { search, status } = req.query;

    const query = { role: 'STAFF' };

    // 1. Validate & process status parameter
    if (status !== undefined) {
      if (typeof status !== 'string') {
        return sendError(res, 'Trạng thái tìm kiếm không hợp lệ!', 400);
      }
      const cleanStatus = status.trim();
      if (cleanStatus && cleanStatus !== 'ALL') {
        if (!ALLOWED_STATUSES.includes(cleanStatus)) {
          return sendError(res, 'Trạng thái tìm kiếm không nằm trong danh mục hợp lệ!', 400);
        }
        query.status = cleanStatus;
      }
    }

    // 2. Validate & process search parameter
    if (search !== undefined) {
      if (typeof search !== 'string') {
        return sendError(res, 'Từ khóa tìm kiếm không hợp lệ!', 400);
      }
      if (search.length > MAX_SEARCH_LENGTH) {
        return sendError(res, `Từ khóa tìm kiếm không được vượt quá ${MAX_SEARCH_LENGTH} ký tự!`, 400);
      }
      const cleanSearch = search.trim();
      if (cleanSearch) {
        const escaped = escapeRegex(cleanSearch);
        query.$or = [
          { fullName: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped, $options: 'i' } }
        ];
      }
    }

    const staffs = await Staff.find(query)
      .select('_id fullName email phone role status createdAt updatedAt')
      .sort({ createdAt: -1 });

    return sendSuccess(res, staffs, 'Lấy danh sách nhân viên thành công!', 200);
  } catch (error) {
    if (isSearchOrFilter) {
      return sendError(res, 'Unable to search staff. Please try again.', 500);
    }
    return sendError(res, 'Unable to load the staff list. Please try again.', 500);
  }
};

/**
 * UC-8.2 — View Staff Detail
 * Actor: Admin (ACTIVE)
 */
exports.getStaffById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    const staff = await Staff.findOne({ _id: id, role: 'STAFF' })
      .select('_id fullName email phone role status createdAt updatedAt');

    if (!staff) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    return sendSuccess(res, sanitizeStaff(staff), 'Lấy thông tin chi tiết nhân viên thành công!', 200);
  } catch (error) {
    return sendError(res, 'Unable to view the selected staff record.', 500);
  }
};

/**
 * UC-8.3 — Create Staff
 * Actor: Admin (ACTIVE)
 */
exports.createStaff = async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};
    const errors = {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!cleanFullName) {
      errors.fullName = 'Họ và tên không được để trống!';
    }

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      errors.email = 'Email không hợp lệ!';
    }

    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!cleanPhone || !PHONE_REGEX.test(cleanPhone)) {
      errors.phone = 'Số điện thoại không hợp lệ (phải gồm 10 chữ số, bắt đầu bằng 03, 05, 07, 08, 09)!';
    }

    const rawPassword = typeof password === 'string' ? password : '';
    if (!rawPassword || rawPassword.length < 6) {
      errors.password = 'Mật khẩu phải có tối thiểu 6 ký tự!';
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu đầu vào không hợp lệ!', 400, errors);
    }

    // Kiểm tra trùng lặp trên Staff và Customer
    const existingStaffEmail = await Staff.findOne({ email: cleanEmail });
    const existingCustEmail = await Customer.findOne({ email: cleanEmail });
    if (existingStaffEmail || existingCustEmail) {
      errors.email = 'Email này đã được sử dụng!';
    }

    const existingStaffPhone = await Staff.findOne({ phone: cleanPhone });
    const existingCustPhone = await Customer.findOne({ phone: cleanPhone });
    if (existingStaffPhone || existingCustPhone) {
      errors.phone = 'Số điện thoại này đã được sử dụng!';
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu bị trùng lặp!', 409, errors);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    const newStaff = await Staff.create({
      fullName: cleanFullName,
      email: cleanEmail,
      phone: cleanPhone,
      password: hashedPassword,
      role: 'STAFF',
      status: 'ACTIVE'
    });

    return sendSuccess(res, sanitizeStaff(newStaff), 'Tạo tài khoản nhân viên thành công!', 201);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'email';
      const errors = {};
      errors[field] = field === 'email' ? 'Email này đã được sử dụng!' : 'Số điện thoại này đã được sử dụng!';
      return sendError(res, 'Dữ liệu bị trùng lặp!', 409, errors);
    }
    return sendError(res, 'Unable to create the staff account. Please try again.', 500);
  }
};

/**
 * UC-8.4 — Update Staff
 * Actor: Admin (ACTIVE)
 */
exports.updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    const targetStaff = await Staff.findOne({ _id: id, role: 'STAFF' });
    if (!targetStaff) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    const { fullName, email, phone } = req.body || {};
    const errors = {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!cleanFullName) {
      errors.fullName = 'Họ và tên không được để trống!';
    }

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      errors.email = 'Email không hợp lệ!';
    }

    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!cleanPhone || !PHONE_REGEX.test(cleanPhone)) {
      errors.phone = 'Số điện thoại không hợp lệ (phải gồm 10 chữ số, bắt đầu bằng 03, 05, 07, 08, 09)!';
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu đầu vào không hợp lệ!', 400, errors);
    }

    // Kiểm tra trùng lặp ngoại trừ chính staff đang sửa
    const emailConflictStaff = await Staff.findOne({ email: cleanEmail, _id: { $ne: id } });
    const emailConflictCust = await Customer.findOne({ email: cleanEmail });
    if (emailConflictStaff || emailConflictCust) {
      errors.email = 'Email này đã được sử dụng!';
    }

    const phoneConflictStaff = await Staff.findOne({ phone: cleanPhone, _id: { $ne: id } });
    const phoneConflictCust = await Customer.findOne({ phone: cleanPhone });
    if (phoneConflictStaff || phoneConflictCust) {
      errors.phone = 'Số điện thoại này đã được sử dụng!';
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu bị trùng lặp!', 409, errors);
    }

    targetStaff.fullName = cleanFullName;
    targetStaff.email = cleanEmail;
    targetStaff.phone = cleanPhone;
    await targetStaff.save();

    return sendSuccess(res, sanitizeStaff(targetStaff), 'Cập nhật thông tin nhân viên thành công!', 200);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'email';
      const errors = {};
      errors[field] = field === 'email' ? 'Email này đã được sử dụng!' : 'Số điện thoại này đã được sử dụng!';
      return sendError(res, 'Dữ liệu bị trùng lặp!', 409, errors);
    }
    return sendError(res, 'Unable to update staff information. Please try again.', 500);
  }
};

/**
 * UC-8.5 — Deactivate Staff
 * Actor: Admin (ACTIVE)
 */
exports.deactivateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    const targetStaff = await Staff.findOne({ _id: id, role: 'STAFF' });
    if (!targetStaff) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    // Thao tác lặp lại nếu đã INACTIVE: trả về 200, không ghi thừa DB
    if (targetStaff.status === 'INACTIVE') {
      return sendSuccess(res, sanitizeStaff(targetStaff), 'Tài khoản nhân viên đã ở trạng thái vô hiệu hóa.', 200);
    }

    targetStaff.status = 'INACTIVE';
    targetStaff.resetOtp = null;
    targetStaff.resetOtpExpiry = null;
    await targetStaff.save();

    return sendSuccess(res, sanitizeStaff(targetStaff), 'Vô hiệu hóa tài khoản nhân viên thành công!', 200);
  } catch (error) {
    return sendError(res, 'Unable to deactivate the staff account. Please try again.', 500);
  }
};

/**
 * Activate / Unlock Staff
 * Actor: Admin (ACTIVE)
 */
exports.activateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    const targetStaff = await Staff.findOne({ _id: id, role: 'STAFF' });
    if (!targetStaff) {
      return sendError(res, 'The selected staff account is unavailable.', 404);
    }

    // Thao tác lặp lại nếu đã ACTIVE
    if (targetStaff.status === 'ACTIVE') {
      return sendSuccess(res, sanitizeStaff(targetStaff), 'Tài khoản nhân viên đã ở trạng thái hoạt động.', 200);
    }

    targetStaff.status = 'ACTIVE';
    await targetStaff.save();

    return sendSuccess(res, sanitizeStaff(targetStaff), 'Mở khóa tài khoản nhân viên thành công!', 200);
  } catch (error) {
    return sendError(res, 'Unable to activate the staff account. Please try again.', 500);
  }
};
