const PriceRule = require('../models/priceRule');
const Court = require('../models/court');
const { sendSuccess, sendError } = require('../utils/response');

// Helper kiểm tra định dạng giờ HH:mm
const isValidTimeFormat = (timeStr) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);

// Helper chuyển HH:mm thành số phút để so sánh
const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Chuẩn hóa loại sân về 3 phân khúc chuẩn: STANDARD, VIP, PREMIUM
const normalizeCourtType = (type) => {
  if (!type) return 'STANDARD';
  const t = String(type).trim().toUpperCase();
  if (t === 'VIP' || t.includes('VIP') || t.includes('GỖ')) return 'VIP';
  if (t === 'PREMIUM' || t.includes('PREMIUM') || t.includes('THI ĐẤU') || t.includes('PVC')) return 'PREMIUM';
  return 'STANDARD';
};

// Cấu hình metadata hiển thị cho từng loại sân trên Homepage
const COURT_METADATA = {
  STANDARD: {
    id: 'standard',
    code: 'STANDARD',
    name: 'Sân Tiêu Chuẩn',
    badge: 'Phổ biến',
    badgeColor: '#f9f9f9',
    badgeBg: '#2563eb',
    description: 'Phù hợp cho nhu cầu chơi cầu lông hàng ngày, tập luyện, giao lưu cùng bạn bè.',
    icon: '🏸',
    iconBg: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    highlighted: false,
    order: 1
  },
  VIP: {
    id: 'vip',
    code: 'VIP',
    name: 'Sân VIP',
    badge: 'Được yêu thích nhất ⭐',
    badgeColor: '#854d0e',
    badgeBg: '#fef08a',
    description: 'Trải nghiệm không gian rộng rãi, thoáng mát, trang thiết bị cao cấp và ánh sáng tối ưu.',
    icon: '👑',
    iconBg: 'linear-gradient(135deg, #eab308, #ca8a04)',
    highlighted: true,
    order: 2
  },
  PREMIUM: {
    id: 'premium',
    code: 'PREMIUM',
    name: 'Sân Thi Đấu',
    badge: 'Chuyên nghiệp',
    badgeColor: '#ffffff',
    badgeBg: '#9333ea',
    description: 'Dành cho các giải đấu, câu lạc bộ chuyên nghiệp với không gian đạt chuẩn thi đấu quốc tế.',
    icon: '⭐',
    iconBg: 'linear-gradient(135deg, #a855f7, #7e22ce)',
    highlighted: false,
    order: 3
  }
};

/**
 * API Public: Lấy danh mục các loại sân hiện có và bảng giá niêm yết cho HomePage
 * - Nếu admin tạo 1 loại sân -> trả về 1 thẻ
 * - Nếu admin tạo 2 loại sân -> trả về 2 thẻ
 * - Tối đa 3 loại sân -> trả về 3 thẻ
 * - Nếu admin chưa tạo giá cho khung giờ nào -> giá trả về 'Chưa xác định'
 */
exports.getPricingOverview = async (req, res) => {
  try {
    // 1. Lấy tất cả các sân đang hoạt động (ACTIVE)
    const activeCourts = await Court.find({ status: 'ACTIVE' }).lean();

    // 2. Thu thập các loại sân đang có mặt trong hệ thống
    const presentTypeCodes = new Set();
    activeCourts.forEach((c) => {
      presentTypeCodes.add(normalizeCourtType(c.courtType));
    });

    // Nếu chưa có sân nào, trả về danh sách rỗng
    if (presentTypeCodes.size === 0) {
      return sendSuccess(res, [], 'Hiện chưa có sân nào trong hệ thống', 200);
    }

    // 3. Sắp xếp thứ tự hiển thị: STANDARD -> VIP -> PREMIUM (tối đa 3 loại)
    const sortedTypes = ['STANDARD', 'VIP', 'PREMIUM'].filter((code) => presentTypeCodes.has(code));

    // 4. Lấy tất cả quy tắc giá đang áp dụng (ACTIVE)
    const allPriceRules = await PriceRule.find({ status: 'ACTIVE' }).lean();

    // 5. Xác định giá cho từng loại sân
    const overviewList = sortedTypes.map((typeCode) => {
      const meta = COURT_METADATA[typeCode];
      const rules = allPriceRules.filter((r) => r.courtType === typeCode || r.courtType === 'ALL');

      // Giá Giờ thường: các ngày trong tuần (T2-T6) trước 17:00
      const regRule = rules.find((r) => r.courtType === typeCode && r.daysOfWeek.some((d) => d >= 1 && d <= 5) && r.startTime < '17:00') ||
                      rules.find((r) => r.courtType === 'ALL' && r.daysOfWeek.some((d) => d >= 1 && d <= 5) && r.startTime < '17:00');

      // Giá Giờ vàng: các ngày trong tuần (T2-T6) từ 17:00 trở đi
      const peakRule = rules.find((r) => r.courtType === typeCode && r.daysOfWeek.some((d) => d >= 1 && d <= 5) && r.startTime >= '17:00') ||
                       rules.find((r) => r.courtType === 'ALL' && r.daysOfWeek.some((d) => d >= 1 && d <= 5) && r.startTime >= '17:00');

      // Giá Cuối tuần: Thứ Bảy (6) hoặc Chủ Nhật (0)
      const weekendRule = rules.find((r) => r.courtType === typeCode && r.daysOfWeek.some((d) => d === 0 || d === 6)) ||
                          rules.find((r) => r.courtType === 'ALL' && r.daysOfWeek.some((d) => d === 0 || d === 6));

      return {
        ...meta,
        priceRegular: regRule ? `${regRule.pricePerHour.toLocaleString('vi-VN')}đ/h` : 'Chưa xác định',
        pricePeak: peakRule ? `${peakRule.pricePerHour.toLocaleString('vi-VN')}đ/h` : 'Chưa xác định',
        priceWeekend: weekendRule ? `${weekendRule.pricePerHour.toLocaleString('vi-VN')}đ/h` : 'Chưa xác định',
        hasPricing: Boolean(regRule || peakRule || weekendRule)
      };
    });

    return sendSuccess(res, overviewList, 'Lấy danh mục loại sân và bảng giá thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// UC-18.1: View Price - Lấy danh sách quy tắc giá thuê sân
exports.getAllPriceRules = async (req, res) => {
  try {
    const { courtType, status, search, dayOfWeek } = req.query;
    const filter = {};

    if (courtType && courtType !== 'ALL_TYPES') {
      filter.courtType = courtType;
    }

    if (status && status !== 'ALL_STATUS') {
      filter.status = status;
    }

    if (dayOfWeek !== undefined && dayOfWeek !== '' && dayOfWeek !== 'ALL_DAYS') {
      filter.daysOfWeek = Number(dayOfWeek);
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
