const mongoose = require('mongoose');
const Court = require('../models/court');
const { sendSuccess, sendError } = require('../utils/response');

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALLOWED_COURT_STATUSES = ['ACTIVE', 'INACTIVE'];
const MAX_SEARCH_LENGTH = 100;

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const sanitizeCourt = (court) => ({
  _id: court._id,
  name: court.name,
  courtName: court.courtName || court.name,
  courtType: court.courtType || 'STANDARD',
  status: court.status,
  description: court.description || '',
  openingTime: court.openingTime || '05:00',
  closingTime: court.closingTime || '23:00',
  createdAt: court.createdAt,
  updatedAt: court.updatedAt
});

/**
 * UC-9.1 — View Court List & UC-9.6 — Search/Filter Court
 * Actors:
 * - List: STAFF, ADMIN (ACTIVE)
 * - Search/Filter: ADMIN (ACTIVE) only
 */
exports.getCourts = async (req, res) => {
  const isSearchOrFilter = req.query.search !== undefined || req.query.status !== undefined;

  // UC-9.6 Phân quyền: Chỉ ADMIN được dùng search/filter
  if (isSearchOrFilter && req.user.role !== 'ADMIN') {
    return sendError(res, 'Bạn không có quyền tìm kiếm hoặc lọc sân!', 403);
  }

  try {
    const { search, status } = req.query;
    const filter = {};

    // 1. Xử lý bộ lọc trạng thái (UC-9.6)
    if (status !== undefined) {
      if (typeof status !== 'string') {
        return sendError(res, 'Trạng thái tìm kiếm không hợp lệ!', 400);
      }
      const cleanStatus = status.trim();
      if (cleanStatus && cleanStatus !== 'ALL') {
        if (!ALLOWED_COURT_STATUSES.includes(cleanStatus)) {
          return sendError(res, 'Trạng thái tìm kiếm không hợp lệ!', 400);
        }
        filter.status = cleanStatus;
      }
    }

    // 2. Xử lý từ khóa tìm kiếm (UC-9.6)
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
        filter.name = { $regex: escaped, $options: 'i' };
      }
    }

    const courts = await Court.find(filter)
      .sort({ createdAt: -1, _id: -1 });

    return sendSuccess(res, courts.map(sanitizeCourt), 'Lấy danh sách sân thành công!', 200);
  } catch (error) {
    if (isSearchOrFilter) {
      return sendError(res, 'Unable to search courts. Please try again.', 500);
    }
    return sendError(res, 'Unable to load the court list. Please try again.', 500);
  }
};

/**
 * UC-9.2 — View Court Detail
 * Actors: STAFF, ADMIN (ACTIVE)
 */
exports.getCourtById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'Unable to view the selected court record.', 404);
    }

    const court = await Court.findById(id);
    if (!court) {
      return sendError(res, 'Unable to view the selected court record.', 404);
    }

    return sendSuccess(res, sanitizeCourt(court), 'Lấy thông tin chi tiết sân thành công!', 200);
  } catch (error) {
    return sendError(res, 'Unable to view the selected court record.', 500);
  }
};

/**
 * UC-9.3 — Create Court
 * Actor: ADMIN (ACTIVE) only
 */
exports.createCourt = async (req, res) => {
  try {
    const { name, courtType, description, openingTime, closingTime } = req.body || {};
    const errors = {};

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      errors.name = 'Tên sân không được để trống!';
    } else if (cleanName.length > 100) {
      errors.name = 'Tên sân không được vượt quá 100 ký tự!';
    }

    const cleanDesc = typeof description === 'string' ? description.trim() : '';
    if (cleanDesc.length > 500) {
      errors.description = 'Mô tả không được vượt quá 500 ký tự!';
    }

    const cleanOpening = typeof openingTime === 'string' ? openingTime.trim() : '05:00';
    if (cleanOpening && !TIME_REGEX.test(cleanOpening)) {
      errors.openingTime = 'Giờ mở cửa không đúng định dạng (HH:mm)!';
    }

    const cleanClosing = typeof closingTime === 'string' ? closingTime.trim() : '23:00';
    if (cleanClosing && !TIME_REGEX.test(cleanClosing)) {
      errors.closingTime = 'Giờ đóng cửa không đúng định dạng (HH:mm)!';
    }

    if (!errors.openingTime && !errors.closingTime && cleanOpening && cleanClosing) {
      if (cleanOpening >= cleanClosing) {
        errors.closingTime = 'Giờ đóng cửa phải sau giờ mở cửa!';
      }
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu không hợp lệ!', 400, errors);
    }

    // Kiểm tra tên sân duy nhất (không phân biệt hoa/thường)
    const existingCourt = await Court.findOne({
      name: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' }
    });

    if (existingCourt) {
      return sendError(res, 'Tên sân này đã tồn tại trong hệ thống!', 409, {
        name: 'Tên sân này đã tồn tại trong hệ thống!'
      });
    }

    const newCourt = await Court.create({
      name: cleanName,
      courtName: cleanName,
      courtType: courtType || 'STANDARD',
      description: cleanDesc,
      openingTime: cleanOpening,
      closingTime: cleanClosing,
      status: 'ACTIVE'
    });

    return sendSuccess(res, sanitizeCourt(newCourt), 'Tạo sân cầu lông thành công!', 201);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Tên sân này đã tồn tại trong hệ thống!', 409, {
        name: 'Tên sân này đã tồn tại trong hệ thống!'
      });
    }
    return sendError(res, 'Unable to create the court. Please try again.', 500);
  }
};

/**
 * UC-9.4 — Update Court
 * Actor: ADMIN (ACTIVE) only
 */
exports.updateCourt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected court is unavailable.', 404);
    }

    const targetCourt = await Court.findById(id);
    if (!targetCourt) {
      return sendError(res, 'The selected court is unavailable.', 404);
    }

    const { name, courtType, description, openingTime, closingTime } = req.body || {};
    const errors = {};

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      errors.name = 'Tên sân không được để trống!';
    } else if (cleanName.length > 100) {
      errors.name = 'Tên sân không được vượt quá 100 ký tự!';
    }

    const cleanDesc = typeof description === 'string' ? description.trim() : '';
    if (cleanDesc.length > 500) {
      errors.description = 'Mô tả không được vượt quá 500 ký tự!';
    }

    const cleanOpening = typeof openingTime === 'string' ? openingTime.trim() : (targetCourt.openingTime || '05:00');
    if (cleanOpening && !TIME_REGEX.test(cleanOpening)) {
      errors.openingTime = 'Giờ mở cửa không đúng định dạng (HH:mm)!';
    }

    const cleanClosing = typeof closingTime === 'string' ? closingTime.trim() : (targetCourt.closingTime || '23:00');
    if (cleanClosing && !TIME_REGEX.test(cleanClosing)) {
      errors.closingTime = 'Giờ đóng cửa không đúng định dạng (HH:mm)!';
    }

    if (!errors.openingTime && !errors.closingTime && cleanOpening && cleanClosing) {
      if (cleanOpening >= cleanClosing) {
        errors.closingTime = 'Giờ đóng cửa phải sau giờ mở cửa!';
      }
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'Dữ liệu không hợp lệ!', 400, errors);
    }

    // Kiểm tra trùng lặp tên sân (loại trừ chính sân đang cập nhật)
    const conflict = await Court.findOne({
      name: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' },
      _id: { $ne: id }
    });

    if (conflict) {
      return sendError(res, 'Tên sân này đã tồn tại trong hệ thống!', 409, {
        name: 'Tên sân này đã tồn tại trong hệ thống!'
      });
    }

    targetCourt.name = cleanName;
    targetCourt.description = cleanDesc;
    targetCourt.openingTime = cleanOpening;
    targetCourt.closingTime = cleanClosing;
    if (courtType) targetCourt.courtType = courtType;
    await targetCourt.save();

    return sendSuccess(res, sanitizeCourt(targetCourt), 'Cập nhật thông tin sân thành công!', 200);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 'Tên sân này đã tồn tại trong hệ thống!', 409, {
        name: 'Tên sân này đã tồn tại trong hệ thống!'
      });
    }
    return sendError(res, 'Unable to update court information. Please try again.', 500);
  }
};

/**
 * UC-9.5 — Deactivate Court
 * Actor: ADMIN (ACTIVE) only
 */
exports.deactivateCourt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 'The selected court is unavailable.', 404);
    }

    const targetCourt = await Court.findById(id);
    if (!targetCourt) {
      return sendError(res, 'The selected court is unavailable.', 404);
    }

    // Nếu đã INACTIVE thì kết thúc thành công, không ghi đè hay thay đổi updatedAt vô ích
    if (targetCourt.status === 'INACTIVE') {
      return sendSuccess(res, sanitizeCourt(targetCourt), 'Sân cầu lông đã ở trạng thái vô hiệu hóa.', 200);
    }

    targetCourt.status = 'INACTIVE';
    await targetCourt.save();

    return sendSuccess(res, sanitizeCourt(targetCourt), 'Vô hiệu hóa sân cầu lông thành công!', 200);
  } catch (error) {
    return sendError(res, 'Unable to deactivate the court. Please try again.', 500);
  }
};
