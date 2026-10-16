const PriceRule = require('../models/priceRule');
const { sendSuccess, sendError } = require('../utils/response');

// Helper kiểm tra định dạng giờ HH:mm
const isValidTimeFormat = (timeStr) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);

// Helper chuyển HH:mm thành số phút để so sánh
const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// UC-18.1: View Price - Lấy danh sách quy tắc giá thuê sân
exports.getAllPriceRules = async (req, res) => {
  try {
    const { courtType, status, search } = req.query;
    const filter = {};

    if (courtType && courtType !== 'ALL_TYPES') {
      filter.courtType = courtType;
    }

    if (status && status !== 'ALL_STATUS') {
      filter.status = status;
    }

    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    const priceRules = await PriceRule.find(filter).sort({ createdAt: -1 });

    return sendSuccess(res, priceRules, 'Lấy danh sách quy tắc giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// Lấy chi tiết 1 quy tắc giá
exports.getPriceRuleById = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await PriceRule.findById(id);
    if (!rule) {
      return sendError(res, 'Không tìm thấy quy tắc giá này!', 404);
    }
    return sendSuccess(res, rule, 'Lấy chi tiết quy tắc giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// UC-18.2: Create Price - Tạo quy tắc giá mới
exports.createPriceRule = async (req, res) => {
  try {
    const { name, courtType, daysOfWeek, startTime, endTime, pricePerHour, description } = req.body;

    // 1. Kiểm tra các trường bắt buộc
    if (!name || !name.trim()) {
      return sendError(res, 'Vui lòng nhập tên quy tắc giá!', 400);
    }

    if (!courtType) {
      return sendError(res, 'Vui lòng chọn loại sân áp dụng!', 400);
    }

    const validCourtTypes = ['STANDARD', 'VIP', 'PREMIUM', 'ALL'];
    if (!validCourtTypes.includes(courtType)) {
      return sendError(res, 'Loại sân không hợp lệ (hỗ trợ STANDARD, VIP, PREMIUM, ALL)!', 400);
    }

    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
      return sendError(res, 'Vui lòng chọn ít nhất một ngày áp dụng trong tuần!', 400);
    }

    const invalidDays = daysOfWeek.some((d) => typeof d !== 'number' || d < 0 || d > 6);
    if (invalidDays) {
      return sendError(res, 'Ngày áp dụng trong tuần không hợp lệ (từ 0: Chủ nhật đến 6: Thứ bảy)!', 400);
    }

    if (!startTime || !isValidTimeFormat(startTime)) {
      return sendError(res, 'Giờ bắt đầu không đúng định dạng HH:mm (VD: 06:00)!', 400);
    }

    if (!endTime || !isValidTimeFormat(endTime)) {
      return sendError(res, 'Giờ kết thúc không đúng định dạng HH:mm (VD: 17:00)!', 400);
    }

    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      return sendError(res, 'Giờ bắt đầu phải trước giờ kết thúc!', 400);
    }

    if (pricePerHour === undefined || pricePerHour === null || isNaN(pricePerHour)) {
      return sendError(res, 'Vui lòng nhập giá thuê mỗi giờ!', 400);
    }

    const numericPrice = Number(pricePerHour);
    if (numericPrice < 0) {
      return sendError(res, 'Giá thuê không được nhỏ hơn 0 VNĐ!', 400);
    }

    // 2. Tạo bản ghi mới
    const newPriceRule = await PriceRule.create({
      name: name.trim(),
      courtType,
      daysOfWeek: Array.from(new Set(daysOfWeek)).sort((a, b) => a - b),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      pricePerHour: numericPrice,
      description: description ? description.trim() : '',
      status: 'ACTIVE'
    });

    return sendSuccess(res, newPriceRule, 'Tạo quy tắc giá mới thành công!', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// UC-18.3: Update Price - Cập nhật quy tắc giá hiện có
exports.updatePriceRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, courtType, daysOfWeek, startTime, endTime, pricePerHour, description } = req.body;

    const existingRule = await PriceRule.findById(id);
    if (!existingRule) {
      return sendError(res, 'Không tìm thấy quy tắc giá cần cập nhật!', 404);
    }

    // 1. Kiểm tra các trường bắt buộc
    if (!name || !name.trim()) {
      return sendError(res, 'Vui lòng nhập tên quy tắc giá!', 400);
    }

    if (!courtType) {
      return sendError(res, 'Vui lòng chọn loại sân áp dụng!', 400);
    }

    const validCourtTypes = ['STANDARD', 'VIP', 'PREMIUM', 'ALL'];
    if (!validCourtTypes.includes(courtType)) {
      return sendError(res, 'Loại sân không hợp lệ (hỗ trợ STANDARD, VIP, PREMIUM, ALL)!', 400);
    }

    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
      return sendError(res, 'Vui lòng chọn ít nhất một ngày áp dụng trong tuần!', 400);
    }

    const invalidDays = daysOfWeek.some((d) => typeof d !== 'number' || d < 0 || d > 6);
    if (invalidDays) {
      return sendError(res, 'Ngày áp dụng trong tuần không hợp lệ (từ 0: Chủ nhật đến 6: Thứ bảy)!', 400);
    }

    if (!startTime || !isValidTimeFormat(startTime)) {
      return sendError(res, 'Giờ bắt đầu không đúng định dạng HH:mm (VD: 06:00)!', 400);
    }

    if (!endTime || !isValidTimeFormat(endTime)) {
      return sendError(res, 'Giờ kết thúc không đúng định dạng HH:mm (VD: 17:00)!', 400);
    }

    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      return sendError(res, 'Giờ bắt đầu phải trước giờ kết thúc!', 400);
    }

    if (pricePerHour === undefined || pricePerHour === null || isNaN(pricePerHour)) {
      return sendError(res, 'Vui lòng nhập giá thuê mỗi giờ!', 400);
    }

    const numericPrice = Number(pricePerHour);
    if (numericPrice < 0) {
      return sendError(res, 'Giá thuê không được nhỏ hơn 0 VNĐ!', 400);
    }

    // 2. Cập nhật dữ liệu
    existingRule.name = name.trim();
    existingRule.courtType = courtType;
    existingRule.daysOfWeek = Array.from(new Set(daysOfWeek)).sort((a, b) => a - b);
    existingRule.startTime = startTime.trim();
    existingRule.endTime = endTime.trim();
    existingRule.pricePerHour = numericPrice;
    if (description !== undefined) {
      existingRule.description = description.trim();
    }

    await existingRule.save();

    return sendSuccess(res, existingRule, 'Cập nhật quy tắc giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// UC-18.4: Deactivate Price - Vô hiệu hóa quy tắc giá (giữ lại dữ liệu lịch sử)
exports.deactivatePriceRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await PriceRule.findById(id);
    if (!rule) {
      return sendError(res, 'Không tìm thấy quy tắc giá cần vô hiệu hóa!', 404);
    }

    rule.status = 'INACTIVE';
    await rule.save();

    return sendSuccess(res, rule, 'Đã vô hiệu hóa quy tắc giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// Kích hoạt lại quy tắc giá (hỗ trợ Admin phục hồi nếu cần)
exports.activatePriceRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await PriceRule.findById(id);
    if (!rule) {
      return sendError(res, 'Không tìm thấy quy tắc giá cần kích hoạt!', 404);
    }

    rule.status = 'ACTIVE';
    await rule.save();

    return sendSuccess(res, rule, 'Đã kích hoạt lại quy tắc giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};
