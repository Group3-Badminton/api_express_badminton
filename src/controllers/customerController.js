const mongoose = require('mongoose');
const User = require('../models/user');
const { sendSuccess, sendError } = require('../utils/response');

const PHONE_REGEX = /(0[3|5|7|8|9])+([0-9]{8})\b/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeCustomer = (customer) => ({
  _id: customer._id,
  fullName: customer.fullName,
  email: customer.email || '',
  phone: customer.phone,
  role: customer.role,
  status: customer.status,
  address: customer.address || '',
  isOnlineAccount: !!customer.password,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt
});

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * UC-6.1 — View Customer List & UC-6.5 — Search/Filter Customer
 * Primary Actor: Staff, Admin (ACTIVE)
 * Business Rule: BR-02, BR-38
 */
exports.getCustomers = async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = { role: 'CUSTOMER' };

    // 1. Lọc theo trạng thái
    if (status !== undefined && status !== '') {
      const cleanStatus = status.trim().toUpperCase();
      if (cleanStatus !== 'ALL') {
        query.status = cleanStatus;
      }
    }

    // 2. Tìm kiếm theo Tên hoặc Số điện thoại (Partial match - BR-38)
    if (search !== undefined && search.trim() !== '') {
      const escaped = escapeRegex(search.trim());
      query.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    const customers = await User.find(query)
      .select('_id fullName email phone role status address password createdAt updatedAt')
      .sort({ createdAt: -1 });

    return sendSuccess(res, customers.map(sanitizeCustomer), 'Lấy danh sách khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể tải danh sách khách hàng. Vui lòng thử lại sau!', 500);
  }
};

/**
 * Lấy chi tiết thông tin một khách hàng
 */
exports.getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await User.findOne({ _id: id, role: 'CUSTOMER' })
      .select('_id fullName email phone role status address password createdAt updatedAt');

    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng!', 404);
    }

    return sendSuccess(res, sanitizeCustomer(customer), 'Lấy thông tin khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể tải thông tin khách hàng. Vui lòng thử lại sau!', 500);
  }
};

/**
 * UC-6.2 — Create Customer
 * Primary Actor: Staff, Admin (ACTIVE)
 * Quy tắc: Tạo khách hàng tại quầy/điện thoại, không tạo mật khẩu đăng nhập (POST-3).
 * Business Rule: BR-02, BR-04 (Số điện thoại là duy nhất).
 */
exports.createCustomer = async (req, res) => {
  try {
    const { fullName, phone, email, address } = req.body || {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    // E1: Kiểm tra trường bắt buộc
    if (!cleanFullName || !cleanPhone) {
      return sendError(res, 'Họ và tên cùng Số điện thoại không được để trống!', 400);
    }

    // E2: Kiểm tra định dạng số điện thoại VN (10 chữ số)
    if (!PHONE_REGEX.test(cleanPhone)) {
      return sendError(res, 'Số điện thoại không đúng định dạng hợp lệ (10 chữ số, đầu số 03, 05, 07, 08, 09)!', 400);
    }

    // E3: Kiểm tra Số điện thoại đã được đăng ký chưa (BR-04)
    const existingPhone = await User.findOne({ phone: cleanPhone });
    if (existingPhone) {
      return sendError(res, 'Số điện thoại này đã được đăng ký trong hệ thống!', 409);
    }

    // Kiểm tra Email nếu có cung cấp
    let cleanEmail = undefined;
    if (email && typeof email === 'string' && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return sendError(res, 'Định dạng Email không hợp lệ!', 400);
      }
      const existingEmail = await User.findOne({ email: cleanEmail });
      if (existingEmail) {
        return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 409);
      }
    }

    // Tạo bản ghi khách hàng (POST-1, POST-2, POST-3: không tạo password)
    const newCustomer = await User.create({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail,
      address: typeof address === 'string' ? address.trim() : '',
      password: null, // Không tạo mật khẩu đăng nhập cho khách tại quầy
      role: 'CUSTOMER',
      status: 'ACTIVE'
    });

    return sendSuccess(res, sanitizeCustomer(newCustomer), 'Tạo hồ sơ khách hàng thành công!', 201);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Thông tin Số điện thoại hoặc Email đã tồn tại!', 409);
    }
    return sendError(res, 'Không thể tạo hồ sơ khách hàng. Vui lòng thử lại sau!', 500);
  }
};

/**
 * UC-6.3 — Update Customer
 * Primary Actor: Staff, Admin (ACTIVE)
 * Business Rule: BR-02, BR-04
 */
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await User.findOne({ _id: id, role: 'CUSTOMER' });
    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng cần cập nhật!', 404);
    }

    const { fullName, phone, email, address } = req.body || {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanFullName || !cleanPhone) {
      return sendError(res, 'Họ và tên cùng Số điện thoại không được để trống!', 400);
    }

    if (!PHONE_REGEX.test(cleanPhone)) {
      return sendError(res, 'Số điện thoại không đúng định dạng hợp lệ (10 chữ số)!', 400);
    }

    // Kiểm tra trùng SĐT nếu có thay đổi
    if (cleanPhone !== customer.phone) {
      const existingPhone = await User.findOne({ phone: cleanPhone, _id: { $ne: id } });
      if (existingPhone) {
        return sendError(res, 'Số điện thoại này đã được sử dụng bởi khách hàng khác!', 409);
      }
    }

    // Kiểm tra trùng Email nếu có cung cấp
    let cleanEmail = customer.email;
    if (email !== undefined) {
      const emailInput = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (emailInput) {
        if (!EMAIL_REGEX.test(emailInput)) {
          return sendError(res, 'Định dạng Email không hợp lệ!', 400);
        }
        const existingEmail = await User.findOne({ email: emailInput, _id: { $ne: id } });
        if (existingEmail) {
          return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 409);
        }
        cleanEmail = emailInput;
      } else {
        cleanEmail = undefined;
      }
    }

    customer.fullName = cleanFullName;
    customer.phone = cleanPhone;
    customer.email = cleanEmail;
    if (address !== undefined) {
      customer.address = typeof address === 'string' ? address.trim() : '';
    }

    await customer.save();

    return sendSuccess(res, sanitizeCustomer(customer), 'Cập nhật thông tin khách hàng thành công!', 200);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Thông tin Số điện thoại hoặc Email bị trùng lặp!', 409);
    }
    return sendError(res, 'Không thể cập nhật thông tin khách hàng. Vui lòng thử lại sau!', 500);
  }
};

/**
 * UC-6.4 — Deactivate Customer (Soft Delete)
 * Primary Actor: Staff, Admin (ACTIVE)
 * Business Rule: BR-06, BR-40 (Bảo toàn lịch sử giao dịch)
 */
exports.deactivateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await User.findOne({ _id: id, role: 'CUSTOMER' });
    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng!', 404);
    }

    if (customer.status === 'INACTIVE') {
      return sendSuccess(res, sanitizeCustomer(customer), 'Khách hàng này đã ở trạng thái vô hiệu hóa từ trước.', 200);
    }

    customer.status = 'INACTIVE';
    await customer.save();

    return sendSuccess(res, sanitizeCustomer(customer), 'Vô hiệu hóa khách hàng thành công! Lịch sử giao dịch được bảo toàn.', 200);
  } catch (error) {
    return sendError(res, 'Không thể vô hiệu hóa khách hàng. Vui lòng thử lại sau!', 500);
  }
};

/**
 * Kích hoạt lại khách hàng (Activate Customer)
 */
exports.activateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await User.findOne({ _id: id, role: 'CUSTOMER' });
    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng!', 404);
    }

    if (customer.status === 'ACTIVE') {
      return sendSuccess(res, sanitizeCustomer(customer), 'Khách hàng này đang ở trạng thái hoạt động.', 200);
    }

    customer.status = 'ACTIVE';
    await customer.save();

    return sendSuccess(res, sanitizeCustomer(customer), 'Mở khóa / Kích hoạt lại tài khoản khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể kích hoạt khách hàng. Vui lòng thử lại sau!', 500);
  }
};
