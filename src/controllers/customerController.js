const mongoose = require('mongoose');
const Customer = require('../models/customer');
const Staff = require('../models/staff');
const { sendSuccess, sendError } = require('../utils/response');

const PHONE_REGEX = /^0[35789][0-9]{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeCustomer = (customer) => ({
  _id: customer._id,
  fullName: customer.fullName,
  email: customer.email || '',
  phone: customer.phone,
  role: customer.role || 'CUSTOMER',
  status: customer.status,
  lockReason: customer.lockReason || '',
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt
});

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

exports.getCustomers = async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    const query = {};
    
    if (status !== undefined && status !== '') {
      const cleanStatus = status.trim().toUpperCase();
      if (cleanStatus !== 'ALL') {
        query.status = cleanStatus;
      }
    }
    if (search !== undefined && search.trim() !== '') {
      const escaped = escapeRegex(search.trim());
      query.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    if (page !== undefined || limit !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
      const skip = (pageNum - 1) * limitNum;

      const [customers, total] = await Promise.all([
        Customer.find(query)
          .select('_id fullName email phone role status password lockReason createdAt updatedAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        Customer.countDocuments(query)
      ]);

      return sendSuccess(
        res,
        {
          items: customers.map(sanitizeCustomer),
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
          }
        },
        'Lấy danh sách khách hàng thành công!',
        200
      );
    }

    const customers = await Customer.find(query)
      .select('_id fullName email phone role status password lockReason createdAt updatedAt')
      .sort({ createdAt: -1 });

    return sendSuccess(res, customers.map(sanitizeCustomer), 'Lấy danh sách khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể tải danh sách khách hàng. Vui lòng thử lại sau!', 500);
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await Customer.findById(id)
      .select('_id fullName email phone role status password createdAt updatedAt');

    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng!', 404);
    }

    return sendSuccess(res, sanitizeCustomer(customer), 'Lấy thông tin khách hàng thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể tải thông tin khách hàng. Vui lòng thử lại sau!', 500);
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const { fullName, phone, email } = req.body || {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanFullName || !cleanPhone) {
      return sendError(res, 'Họ và tên cùng Số điện thoại là bắt buộc.', 400);
    }

    if (!PHONE_REGEX.test(cleanPhone)) {
      return sendError(res, 'Số điện thoại không đúng định dạng hợp lệ (10 chữ số, đầu số 03, 05, 07, 08, 09)!', 400);
    }
    const existingPhoneInCust = await Customer.findOne({ phone: cleanPhone });
    const existingPhoneInStaff = await Staff.findOne({ phone: cleanPhone });
    if (existingPhoneInCust || existingPhoneInStaff) {
      return sendError(res, 'Số điện thoại này đã được đăng ký trong hệ thống!', 409);
    }

    let cleanEmail = null;
    if (email && typeof email === 'string' && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return sendError(res, 'Định dạng Email không hợp lệ!', 400);
      }
      const existingEmailInCust = await Customer.findOne({ email: cleanEmail });
      const existingEmailInStaff = await Staff.findOne({ email: cleanEmail });
      if (existingEmailInCust || existingEmailInStaff) {
        return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 409);
      }
    }
    const newCustomer = await Customer.create({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail,
      password: null,
      role: 'CUSTOMER',
      status: 'ACTIVE'
    });

    return sendSuccess(res, sanitizeCustomer(newCustomer), 'Khách hàng đã được tạo thành công.', 201);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Thông tin Số điện thoại hoặc Email đã tồn tại!', 409);
    }
    return sendError(res, 'Không thể tạo khách hàng vào lúc này. Vui lòng thử lại sau.', 500);
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng cần cập nhật!', 404);
    }

    const { fullName, phone, email } = req.body || {};

    const cleanFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanFullName || !cleanPhone) {
      return sendError(res, 'Vui lòng điền đầy đủ tất cả các trường bắt buộc.', 400);
    }

    if (!PHONE_REGEX.test(cleanPhone)) {
      return sendError(res, 'Số điện thoại không đúng định dạng hợp lệ (10 chữ số)!', 400);
    }

    if (cleanPhone !== customer.phone) {
      const existingPhoneCust = await Customer.findOne({ phone: cleanPhone, _id: { $ne: id } });
      const existingPhoneStaff = await Staff.findOne({ phone: cleanPhone });
      if (existingPhoneCust || existingPhoneStaff) {
        return sendError(res, 'Số điện thoại này đã được sử dụng bởi khách hàng khác!', 409);
      }
    }

    let cleanEmail = customer.email || null;
    if (email !== undefined) {
      const emailInput = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (emailInput) {
        if (!EMAIL_REGEX.test(emailInput)) {
          return sendError(res, 'Định dạng Email không hợp lệ!', 400);
        }
        const existingEmailCust = await Customer.findOne({ email: emailInput, _id: { $ne: id } });
        const existingEmailStaff = await Staff.findOne({ email: emailInput });
        if (existingEmailCust || existingEmailStaff) {
          return sendError(res, 'Địa chỉ Email này đã được sử dụng bởi tài khoản khác!', 409);
        }
        cleanEmail = emailInput;
      } else {
        cleanEmail = null;
      }
    }

    customer.fullName = cleanFullName;
    customer.phone = cleanPhone;
    customer.email = cleanEmail;

    await customer.save();

    return sendSuccess(res, sanitizeCustomer(customer), 'Thông tin khách hàng đã được cập nhật thành công.', 200);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Thông tin Số điện thoại hoặc Email bị trùng lặp!', 409);
    }
    return sendError(res, 'Không thể cập nhật thông tin khách hàng. Vui lòng thử lại sau.', 500);
  }
};

exports.deactivateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return sendError(res, 'Không tìm thấy thông tin khách hàng!', 404);
    }

    if (customer.status === 'INACTIVE') {
      return sendSuccess(res, sanitizeCustomer(customer), 'Khách hàng này hiện đã bị vô hiệu hóa từ trước.', 200);
    }

    customer.status = 'INACTIVE';
    await customer.save();

    return sendSuccess(res, sanitizeCustomer(customer), 'Khách hàng đã được vô hiệu hóa thành công.', 200);
  } catch (error) {
    return sendError(res, 'Không thể vô hiệu hóa khách hàng vào lúc này. Vui lòng thử lại sau.', 500);
  }
};

exports.activateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Khách hàng không tồn tại hoặc ID không hợp lệ!', 404);
    }

    const customer = await Customer.findById(id);
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
