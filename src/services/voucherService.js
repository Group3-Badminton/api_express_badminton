const mongoose = require('mongoose');
const Voucher = require('../models/voucher');

class VoucherService {
  /**
   * Tính toán trạng thái thời gian và hiệu lực chi tiết cho 1 voucher
   */
  computeValidity(voucher) {
    const now = new Date();
    const start = new Date(voucher.startDate);
    const end = new Date(voucher.endDate);

    let timeStatus = 'VALID'; // NOT_STARTED | VALID | EXPIRED
    if (now < start) {
      timeStatus = 'NOT_STARTED';
    } else if (now > end) {
      timeStatus = 'EXPIRED';
    }

    const isUsageExceeded = voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit;
    const isApplicable = voucher.status === 'ACTIVE' && timeStatus === 'VALID' && !isUsageExceeded;

    return {
      timeStatus,
      isUsageExceeded,
      isApplicable
    };
  }

  /**
   * UC-15.1 & UC-15.6: Lấy danh sách voucher có tìm kiếm, lọc và phân trang
   * Actor: Staff, Admin
   */
  async getVouchers(params = {}) {
    const {
      search,
      status,
      validityStatus,
      courtType,
      startDateFrom,
      startDateTo,
      endDateFrom,
      endDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = params;

    const query = {};

    // Tìm kiếm theo code hoặc tên
    if (search && search.trim()) {
      const cleanSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { code: { $regex: cleanSearch, $options: 'i' } },
        { name: { $regex: cleanSearch, $options: 'i' } }
      ];
    }

    // Lọc theo loại sân áp dụng
    if (courtType && courtType !== 'ALL') {
      query.applicableCourtTypes = { $in: [courtType, 'ALL'] };
    }

    // Lọc theo trạng thái quản trị (ACTIVE / INACTIVE)
    if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
      query.status = status;
    }

    // Lọc theo trạng thái thời gian hiệu lực
    const now = new Date();
    if (validityStatus === 'VALID') {
      query.startDate = { ...query.startDate, $lte: now };
      query.endDate = { ...query.endDate, $gte: now };
    } else if (validityStatus === 'EXPIRED') {
      query.endDate = { ...query.endDate, $lt: now };
    } else if (validityStatus === 'NOT_STARTED') {
      query.startDate = { ...query.startDate, $gt: now };
    }

    // Lọc theo khoảng ngày hiệu lực nếu người dùng chỉ định
    if (startDateFrom || startDateTo) {
      query.startDate = query.startDate || {};
      if (startDateFrom) query.startDate.$gte = new Date(startDateFrom);
      if (startDateTo) query.startDate.$lte = new Date(startDateTo);
    }

    if (endDateFrom || endDateTo) {
      query.endDate = query.endDate || {};
      if (endDateFrom) query.endDate.$gte = new Date(endDateFrom);
      if (endDateTo) query.endDate.$lte = new Date(endDateTo);
    }

    // Kiểm tra sort field hợp lệ để tránh injection
    const allowedSortFields = [
      'code',
      'name',
      'discountValue',
      'startDate',
      'endDate',
      'status',
      'usedCount',
      'createdAt'
    ];
    const finalSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const finalSortOrder = sortOrder === 'asc' ? 1 : -1;
    const sort = { [finalSortBy]: finalSortOrder, _id: -1 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Voucher.find(query)
        .populate('createdBy', 'fullName email')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Voucher.countDocuments(query)
    ]);

    // Bổ sung thuộc tính tính toán thời gian và khả năng áp dụng
    const enrichedItems = items.map((v) => ({
      ...v,
      ...this.computeValidity(v)
    }));

    return {
      items: enrichedItems,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    };
  }

  /**
   * UC-15.2: Xem chi tiết voucher
   * Actor: Staff, Admin
   */
  async getVoucherById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('Mã định danh voucher không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const voucher = await Voucher.findById(id).populate('createdBy', 'fullName email').lean();
    if (!voucher) {
      const err = new Error('Không tìm thấy voucher!');
      err.statusCode = 404;
      throw err;
    }

    return {
      ...voucher,
      ...this.computeValidity(voucher)
    };
  }

  /**
   * UC-15.3: Tạo voucher mới
   * Actor: Admin
   */
  async createVoucher(data, adminUserId) {
    const {
      code,
      name,
      discountType = 'PERCENTAGE',
      discountValue,
      maxDiscountAmount,
      minInvoiceAmount = 0,
      startDate,
      endDate,
      usageLimit,
      applicableCourtTypes = ['ALL'],
      description
    } = data;

    if (!code || !code.trim()) {
      const err = new Error('Mã voucher không được để trống!');
      err.statusCode = 400;
      throw err;
    }

    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,50}$/.test(cleanCode)) {
      const err = new Error('Mã voucher chỉ gồm chữ cái, số, dấu gạch nối (3-50 ký tự)!');
      err.statusCode = 400;
      throw err;
    }

    if (!name || !name.trim()) {
      const err = new Error('Tên voucher không được để trống!');
      err.statusCode = 400;
      throw err;
    }

    const cleanName = name.trim();

    if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(discountType)) {
      const err = new Error('Loại giảm giá không hợp lệ (chỉ chấp nhận PERCENTAGE hoặc FIXED_AMOUNT)!');
      err.statusCode = 400;
      throw err;
    }

    const parsedVal = Number(discountValue);
    if (isNaN(parsedVal) || parsedVal <= 0) {
      const err = new Error('Mức giảm giá phải là số lớn hơn 0!');
      err.statusCode = 400;
      throw err;
    }

    if (discountType === 'PERCENTAGE' && parsedVal > 100) {
      const err = new Error('Giảm theo phần trăm không được vượt quá 100%!');
      err.statusCode = 400;
      throw err;
    }

    const parsedMinInvoice = Number(minInvoiceAmount || 0);
    if (isNaN(parsedMinInvoice) || parsedMinInvoice < 0) {
      const err = new Error('Giá trị đơn tối thiểu không được âm!');
      err.statusCode = 400;
      throw err;
    }

    let parsedMaxDiscount = null;
    if (maxDiscountAmount !== undefined && maxDiscountAmount !== null && maxDiscountAmount !== '') {
      parsedMaxDiscount = Number(maxDiscountAmount);
      if (isNaN(parsedMaxDiscount) || parsedMaxDiscount <= 0) {
        const err = new Error('Mức giảm tối đa phải lớn hơn 0!');
        err.statusCode = 400;
        throw err;
      }
    }

    if (!startDate || !endDate) {
      const err = new Error('Vui lòng cung cấp cả ngày bắt đầu và ngày kết thúc!');
      err.statusCode = 400;
      throw err;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const err = new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    if (start >= end) {
      const err = new Error('Thời gian bắt đầu phải trước thời gian kết thúc!');
      err.statusCode = 400;
      throw err;
    }

    let parsedUsageLimit = null;
    if (usageLimit !== undefined && usageLimit !== null && usageLimit !== '') {
      parsedUsageLimit = Number(usageLimit);
      if (isNaN(parsedUsageLimit) || !Number.isInteger(parsedUsageLimit) || parsedUsageLimit <= 0) {
        const err = new Error('Giới hạn lượt sử dụng phải là số nguyên dương!');
        err.statusCode = 400;
        throw err;
      }
    }

    // Ràng buộc duy nhất: mã voucher không được trùng (case-insensitive)
    const existing = await Voucher.findOne({ code: cleanCode });
    if (existing) {
      const err = new Error(`Mã voucher "${cleanCode}" đã tồn tại trên hệ thống!`);
      err.statusCode = 409;
      throw err;
    }

    let normalizedCourtTypes = ['ALL'];
    if (Array.isArray(applicableCourtTypes) && applicableCourtTypes.length > 0) {
      if (applicableCourtTypes.includes('ALL')) {
        normalizedCourtTypes = ['ALL'];
      } else {
        normalizedCourtTypes = [...new Set(applicableCourtTypes.map((t) => String(t).trim().toUpperCase()))];
      }
    } else if (typeof applicableCourtTypes === 'string' && applicableCourtTypes.trim()) {
      const parts = applicableCourtTypes.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
      normalizedCourtTypes = parts.includes('ALL') ? ['ALL'] : parts;
    }

    const voucher = await Voucher.create({
      code: cleanCode,
      name: cleanName,
      discountType,
      discountValue: parsedVal,
      maxDiscountAmount: parsedMaxDiscount,
      minInvoiceAmount: parsedMinInvoice,
      startDate: start,
      endDate: end,
      usageLimit: parsedUsageLimit,
      applicableCourtTypes: normalizedCourtTypes,
      usedCount: 0,
      status: 'ACTIVE',
      description: description ? description.trim() : '',
      createdBy: adminUserId
    });

    return {
      ...voucher.toObject(),
      ...this.computeValidity(voucher)
    };
  }

  /**
   * UC-15.4: Cập nhật voucher
   * Actor: Admin
   * Không cho phép chỉnh sửa usedCount, createdBy qua API này
   */
  async updateVoucher(id, data) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('Mã định danh voucher không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      const err = new Error('Không tìm thấy voucher!');
      err.statusCode = 404;
      throw err;
    }

    // Kiểm tra mã voucher nếu có thay đổi
    if (data.code !== undefined) {
      const cleanCode = String(data.code).trim().toUpperCase();
      if (!cleanCode) {
        const err = new Error('Mã voucher không được để trống!');
        err.statusCode = 400;
        throw err;
      }
      if (!/^[A-Z0-9_-]{3,50}$/.test(cleanCode)) {
        const err = new Error('Mã voucher chỉ gồm chữ cái, số, dấu gạch nối (3-50 ký tự)!');
        err.statusCode = 400;
        throw err;
      }

      if (cleanCode !== voucher.code) {
        const dup = await Voucher.findOne({ code: cleanCode, _id: { $ne: id } });
        if (dup) {
          const err = new Error(`Mã voucher "${cleanCode}" đã được sử dụng bởi voucher khác!`);
          err.statusCode = 409;
          throw err;
        }
        voucher.code = cleanCode;
      }
    }

    if (data.name !== undefined) {
      const cleanName = String(data.name).trim();
      if (!cleanName) {
        const err = new Error('Tên voucher không được để trống!');
        err.statusCode = 400;
        throw err;
      }
      voucher.name = cleanName;
    }

    if (data.discountType !== undefined) {
      if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(data.discountType)) {
        const err = new Error('Loại giảm giá không hợp lệ!');
        err.statusCode = 400;
        throw err;
      }
      voucher.discountType = data.discountType;
    }

    if (data.discountValue !== undefined) {
      const parsedVal = Number(data.discountValue);
      if (isNaN(parsedVal) || parsedVal <= 0) {
        const err = new Error('Mức giảm giá phải lớn hơn 0!');
        err.statusCode = 400;
        throw err;
      }
      if (voucher.discountType === 'PERCENTAGE' && parsedVal > 100) {
        const err = new Error('Giảm theo phần trăm không được vượt quá 100%!');
        err.statusCode = 400;
        throw err;
      }
      voucher.discountValue = parsedVal;
    }

    if (data.minInvoiceAmount !== undefined) {
      const parsedMin = Number(data.minInvoiceAmount);
      if (isNaN(parsedMin) || parsedMin < 0) {
        const err = new Error('Giá trị đơn tối thiểu không được âm!');
        err.statusCode = 400;
        throw err;
      }
      voucher.minInvoiceAmount = parsedMin;
    }

    if (data.maxDiscountAmount !== undefined) {
      if (data.maxDiscountAmount === null || data.maxDiscountAmount === '') {
        voucher.maxDiscountAmount = null;
      } else {
        const parsedMax = Number(data.maxDiscountAmount);
        if (isNaN(parsedMax) || parsedMax <= 0) {
          const err = new Error('Mức giảm tối đa phải lớn hơn 0!');
          err.statusCode = 400;
          throw err;
        }
        voucher.maxDiscountAmount = parsedMax;
      }
    }

    // Kiểm tra thời hạn
    const newStart = data.startDate ? new Date(data.startDate) : voucher.startDate;
    const newEnd = data.endDate ? new Date(data.endDate) : voucher.endDate;

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      const err = new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    if (newStart >= newEnd) {
      const err = new Error('Thời gian bắt đầu phải trước thời gian kết thúc!');
      err.statusCode = 400;
      throw err;
    }

    voucher.startDate = newStart;
    voucher.endDate = newEnd;

    // Giới hạn lượt sử dụng: không cho phép cập nhật xuống thấp hơn usedCount đã dùng
    if (data.usageLimit !== undefined) {
      if (data.usageLimit === null || data.usageLimit === '') {
        voucher.usageLimit = null;
      } else {
        const parsedLimit = Number(data.usageLimit);
        if (isNaN(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
          const err = new Error('Giới hạn lượt sử dụng phải là số nguyên dương!');
          err.statusCode = 400;
          throw err;
        }
        if (parsedLimit < voucher.usedCount) {
          const err = new Error(
            `Không thể đặt giới hạn (${parsedLimit}) thấp hơn số lượt đã dùng (${voucher.usedCount})!`
          );
          err.statusCode = 400;
          throw err;
        }
        voucher.usageLimit = parsedLimit;
      }
    }

    if (data.applicableCourtTypes !== undefined) {
      if (Array.isArray(data.applicableCourtTypes) && data.applicableCourtTypes.length > 0) {
        if (data.applicableCourtTypes.includes('ALL')) {
          voucher.applicableCourtTypes = ['ALL'];
        } else {
          voucher.applicableCourtTypes = [...new Set(data.applicableCourtTypes.map((t) => String(t).trim().toUpperCase()))];
        }
      } else if (typeof data.applicableCourtTypes === 'string' && data.applicableCourtTypes.trim()) {
        const parts = data.applicableCourtTypes.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
        voucher.applicableCourtTypes = parts.includes('ALL') ? ['ALL'] : parts;
      } else {
        voucher.applicableCourtTypes = ['ALL'];
      }
    }

    if (data.description !== undefined) {
      voucher.description = String(data.description).trim();
    }

    await voucher.save();

    return {
      ...voucher.toObject(),
      ...this.computeValidity(voucher)
    };
  }

  /**
   * UC-15.5: Vô hiệu hóa voucher
   * Actor: Admin
   * Giữ nguyên toàn bộ lịch sử booking/invoices, chỉ ngăn áp dụng vào giao dịch mới
   */
  async deactivateVoucher(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('Mã định danh voucher không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      const err = new Error('Không tìm thấy voucher!');
      err.statusCode = 404;
      throw err;
    }

    if (voucher.status === 'INACTIVE') {
      const err = new Error('Voucher này đã ở trạng thái ngưng áp dụng (INACTIVE) trước đó!');
      err.statusCode = 400;
      throw err;
    }

    voucher.status = 'INACTIVE';
    await voucher.save();

    return {
      ...voucher.toObject(),
      ...this.computeValidity(voucher)
    };
  }

  /**
   * Kích hoạt lại voucher
   * Actor: Admin
   */
  async activateVoucher(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('Mã định danh voucher không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      const err = new Error('Không tìm thấy voucher!');
      err.statusCode = 404;
      throw err;
    }

    if (voucher.status === 'ACTIVE') {
      const err = new Error('Voucher này hiện đã đang ở trạng thái hoạt động!');
      err.statusCode = 400;
      throw err;
    }

    voucher.status = 'ACTIVE';
    await voucher.save();

    return {
      ...voucher.toObject(),
      ...this.computeValidity(voucher)
    };
  }
}

module.exports = new VoucherService();
