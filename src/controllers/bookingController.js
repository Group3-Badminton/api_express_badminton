const Booking = require('../models/booking');
const Court = require('../models/court');
const User = require('../models/user');
const TimeSlot = require('../models/timeSlot');
const Price = require('../models/price');
const Voucher = require('../models/voucher');
const Notification = require('../models/notification');
const { sendSuccess, sendError } = require('../utils/response');

// 1. Lấy danh sách booking (Hỗ trợ tìm kiếm, lọc theo ngày, trạng thái, sân, phân trang, vai trò)
exports.getAllBookings = async (req, res) => {
  try {
    const {
      search = '',
      status = '',
      paymentStatus = '',
      courtId = '',
      startDate = '',
      endDate = '',
      bookingDate = '',
      customerId = '',
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    // Xây dựng query filter cho MongoDB
    const filter = {};

    // Nếu người dùng là khách hàng thường, chỉ xem đơn đặt sân của chính mình
    if (req.user && req.user.role === 'CUSTOMER') {
      filter.customerId = req.user.userId;
    } else if (customerId) {
      filter.customerId = customerId;
    }

    // Lọc theo trạng thái đặt sân
    if (status && status !== 'ALL') {
      filter.status = status;
    }

    // Lọc theo trạng thái thanh toán
    if (paymentStatus && paymentStatus !== 'ALL') {
      filter.paymentStatus = paymentStatus;
    }

    // Lọc theo sân
    if (courtId && courtId !== 'ALL') {
      filter.courtId = courtId;
    }

    // Lọc theo ngày đặt sân
    if (bookingDate) {
      const start = new Date(bookingDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(bookingDate);
      end.setHours(23, 59, 59, 999);
      filter.bookingDate = { $gte: start, $lte: end };
    } else if (startDate || endDate) {
      filter.bookingDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.bookingDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.bookingDate.$lte = end;
      }
    }

    // Tìm kiếm theo từ khóa (Mã đơn hoặc Tên/SĐT/Email khách hàng)
    if (search && search.trim()) {
      const keyword = search.trim();
      const userMatches = await User.find({
        $or: [
          { fullName: { $regex: keyword, $options: 'i' } },
          { phone: { $regex: keyword, $options: 'i' } },
          { email: { $regex: keyword, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = userMatches.map((u) => u._id);

      filter.$or = [
        { bookingCode: { $regex: keyword, $options: 'i' } },
        { customerId: { $in: userIds } }
      ];
    }

    // Sắp xếp
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Thực thi truy vấn danh sách bookings
    const [bookings, totalRecords] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email phone address')
        .populate('courtId', 'courtName courtType location description')
        .populate('voucherId', 'voucherCode voucherName discountType discountValue maxDiscount')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(filter)
    ]);

    // Thống kê nhanh theo các trạng thái
    const statsFilter = req.user && req.user.role === 'CUSTOMER' ? { customerId: req.user.userId } : {};

    const [
      totalAll,
      pendingCount,
      confirmedCount,
      checkedInCount,
      completedCount,
      cancelledCount,
      revenueResult
    ] = await Promise.all([
      Booking.countDocuments(statsFilter),
      Booking.countDocuments({ ...statsFilter, status: 'PENDING' }),
      Booking.countDocuments({ ...statsFilter, status: 'CONFIRMED' }),
      Booking.countDocuments({ ...statsFilter, status: 'CHECKED_IN' }),
      Booking.countDocuments({ ...statsFilter, status: 'COMPLETED' }),
      Booking.countDocuments({ ...statsFilter, status: 'CANCELLED' }),
      Booking.aggregate([
        {
          $match: {
            ...statsFilter,
            status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
            paymentStatus: 'PAID'
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmount' }
          }
        }
      ])
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    return sendSuccess(
      res,
      {
        bookings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalRecords,
          totalPages: Math.ceil(totalRecords / limitNum)
        },
        stats: {
          totalAll,
          pendingCount,
          confirmedCount,
          checkedInCount,
          completedCount,
          cancelledCount,
          totalRevenue
        }
      },
      'Lấy danh sách đặt sân thành công!',
      200
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 2. Lấy chi tiết đơn đặt sân theo ID
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue maxDiscount')
      .lean();

    if (!booking) {
      return sendError(res, 'Không tìm thấy thông tin đơn đặt sân!', 404);
    }

    // Bảo mật: Nếu là khách hàng, chỉ được xem đơn của chính mình
    if (req.user && req.user.role === 'CUSTOMER') {
      if (booking.customerId?._id?.toString() !== req.user.userId) {
        return sendError(res, 'Bạn không có quyền truy cập vào đơn đặt sân này!', 403);
      }
    }

    return sendSuccess(res, booking, 'Lấy chi tiết đơn đặt sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 3. Lấy danh sách sân bóng (COURTS)
exports.getCourts = async (req, res) => {
  try {
    const courts = await Court.find({ status: 'ACTIVE' })
      .select('_id courtName courtType location description status')
      .lean();
    return sendSuccess(res, courts, 'Lấy danh sách sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 4. Lấy danh sách khung giờ cố định (TIME_SLOTS)
exports.getTimeSlots = async (req, res) => {
  try {
    const slots = await TimeSlot.find({ status: 'ACTIVE' })
      .sort({ startTime: 1 })
      .lean();
    return sendSuccess(res, slots, 'Lấy danh sách khung giờ thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 5. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày (AVAILABILITY FLOW)
exports.getCourtAvailability = async (req, res) => {
  try {
    const { courtId, bookingDate } = req.query;

    if (!courtId || !bookingDate) {
      return sendError(res, 'Vui lòng cung cấp mã sân (courtId) và ngày đặt (bookingDate)!', 400);
    }

    const court = await Court.findById(courtId);
    if (!court) {
      return sendError(res, 'Không tìm thấy thông tin sân cầu lông!', 404);
    }

    // Phân loại ngày: Cuối tuần (T7, CN) hay Ngày thường
    const dateObj = new Date(bookingDate);
    const dayOfWeek = dateObj.getDay(); // 0: CN, 6: T7
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    // Lấy tất cả khung giờ hoạt động
    const timeSlots = await TimeSlot.find({ status: 'ACTIVE' }).sort({ startTime: 1 }).lean();

    // Lấy bảng giá đã cấu hình cho sân này theo dayType
    const prices = await Price.find({
      courtId,
      dayType,
      status: 'ACTIVE'
    }).lean();

    // Lấy danh sách các đơn đặt sân đang hoạt động trong ngày này tại sân này (loại trừ đã hủy)
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const activeBookings = await Booking.find({
      courtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'CANCELLED' }
    }).select('startTime endTime bookingCode status').lean();

    // Tổng hợp thông tin từng khung giờ: Giá tiền & Trạng thái đã đặt / còn trống
    const slotDetails = timeSlots.map((slot) => {
      // Tìm giá cấu hình
      const priceDoc = prices.find(
        (p) =>
          (p.timeSlotId && p.timeSlotId.toString() === slot._id.toString()) ||
          p.timeSlot.includes(slot.startTime)
      );

      // Giá mặc định nếu chưa cấu hình
      const defaultPrice = isWeekend ? 140000 : 100000;
      const slotPrice = priceDoc ? priceDoc.price : defaultPrice;

      // Kiểm tra xem khung giờ này đã có ai đặt chưa
      const bookedBooking = activeBookings.find(
        (b) => b.startTime === slot.startTime
      );

      return {
        timeSlotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slot.label || `${slot.startTime} - ${slot.endTime}`,
        price: slotPrice,
        dayType,
        isBooked: !!bookedBooking,
        bookingCode: bookedBooking ? bookedBooking.bookingCode : null
      };
    });

    return sendSuccess(
      res,
      {
        court: {
          _id: court._id,
          courtName: court.courtName,
          courtType: court.courtType,
          location: court.location,
          description: court.description
        },
        bookingDate,
        dayType,
        slots: slotDetails
      },
      'Lấy thông tin tình trạng khung giờ sân thành công!',
      200
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 6. Kiểm tra và áp dụng Mã Giảm Giá (VOUCHER FLOW)
exports.validateVoucher = async (req, res) => {
  try {
    const { voucherCode, orderAmount = 0 } = req.body;

    if (!voucherCode) {
      return sendError(res, 'Vui lòng cung cấp mã voucher!', 400);
    }

    const code = voucherCode.trim().toUpperCase();
    const voucher = await Voucher.findOne({ voucherCode: code, status: 'ACTIVE' });

    if (!voucher) {
      return sendError(res, 'Mã giảm giá không tồn tại hoặc đã bị khóa!', 404);
    }

    const now = new Date();
    if (voucher.startDate && now < new Date(voucher.startDate)) {
      return sendError(res, 'Mã giảm giá chưa đến thời gian áp dụng!', 400);
    }

    if (voucher.endDate && now > new Date(voucher.endDate)) {
      return sendError(res, 'Mã giảm giá đã hết hạn sử dụng!', 400);
    }

    if (voucher.usageLimit > 0 && voucher.usedCount >= voucher.usageLimit) {
      return sendError(res, 'Mã giảm giá đã hết lượt sử dụng!', 400);
    }

    const currentAmount = Number(orderAmount) || 0;
    if (voucher.minOrderAmount > 0 && currentAmount < voucher.minOrderAmount) {
      return sendError(
        res,
        `Đơn đặt sân phải có giá trị tối thiểu từ ${voucher.minOrderAmount.toLocaleString('vi-VN')}đ để sử dụng mã này!`,
        400
      );
    }

    // Tính toán số tiền được giảm
    let discount = 0;
    if (voucher.discountType === 'PERCENTAGE') {
      discount = Math.round((currentAmount * voucher.discountValue) / 100);
      if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
        discount = voucher.maxDiscount;
      }
    } else {
      // Giảm tiền cố định
      discount = Math.min(voucher.discountValue, currentAmount);
    }

    const finalAmount = Math.max(0, currentAmount - discount);

    return sendSuccess(
      res,
      {
        voucherId: voucher._id,
        voucherCode: voucher.voucherCode,
        voucherName: voucher.voucherName,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        discount,
        finalAmount
      },
      'Áp dụng mã giảm giá thành công!',
      200
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 7. Tạo đơn đặt sân mới (BOOKING FLOW - Ngăn trùng lịch, kiểm tra bảng giá & voucher)
exports.createBooking = async (req, res) => {
  try {
    const {
      customerId: bodyCustomerId,
      courtId,
      bookingDate,
      startTime,
      endTime,
      voucherCode,
      voucherId: bodyVoucherId,
      paymentMethod = 'VIETQR',
      paymentStatus: bodyPaymentStatus,
      status: bodyStatus,
      note = ''
    } = req.body;

    // Xác định khách hàng: Lấy từ token đăng nhập nếu có, hoặc từ body (Admin đặt hộ)
    const customerId = req.user?.userId || bodyCustomerId;

    if (!customerId) {
      return sendError(res, 'Vui lòng đăng nhập hoặc cung cấp thông tin khách hàng đặt sân!', 400);
    }

    if (!courtId || !bookingDate || !startTime || !endTime) {
      return sendError(res, 'Vui lòng cung cấp đầy đủ thông tin: Sân, Ngày đặt và Khung giờ!', 400);
    }

    // 1. Kiểm tra tồn tại Sân
    const court = await Court.findById(courtId);
    if (!court || court.status !== 'ACTIVE') {
      return sendError(res, 'Sân được chọn hiện không khả dụng hoặc đang bảo trì!', 400);
    }

    // 2. Kiểm tra ngày đặt không được trong quá khứ
    const bookingDateObj = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(bookingDateObj);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate < today) {
      return sendError(res, 'Không thể đặt sân cho ngày trong quá khứ!', 400);
    }

    // 3. KIỂM TRA TRÙNG LỊCH (CONFLICT CHECK)
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingBooking = await Booking.findOne({
      courtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      startTime,
      status: { $ne: 'CANCELLED' }
    });

    if (existingBooking) {
      return sendError(
        res,
        `Khung giờ ${startTime} - ${endTime} tại ${court.courtName} đã có khách đặt trước. Vui lòng chọn khung giờ khác!`,
        400
      );
    }

    // 4. TÍNH GIÁ TIỀN TỰ ĐỘNG TỪ BẢNG GIÁ (PRICE)
    const dayOfWeek = bookingDateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    let basePrice = req.body.price ? Number(req.body.price) : 0;
    if (!basePrice) {
      const priceDoc = await Price.findOne({
        courtId,
        dayType,
        timeSlot: { $regex: startTime },
        status: 'ACTIVE'
      });

      if (priceDoc) {
        basePrice = priceDoc.price;
      } else {
        basePrice = isWeekend ? 140000 : 100000;
      }
    }

    // 5. XỬ LÝ VOUCHER & GIẢM GIÁ
    let discount = 0;
    let appliedVoucherId = null;

    if (voucherCode || bodyVoucherId) {
      let voucherQuery = null;
      if (voucherCode) {
        voucherQuery = { voucherCode: voucherCode.trim().toUpperCase(), status: 'ACTIVE' };
      } else if (bodyVoucherId) {
        voucherQuery = { _id: bodyVoucherId, status: 'ACTIVE' };
      }

      const voucher = await Voucher.findOne(voucherQuery);
      if (voucher) {
        const now = new Date();
        const isValidDate = (!voucher.startDate || now >= new Date(voucher.startDate)) &&
                            (!voucher.endDate || now <= new Date(voucher.endDate));
        const hasLimit = voucher.usageLimit <= 0 || voucher.usedCount < voucher.usageLimit;
        const meetsMinOrder = !voucher.minOrderAmount || basePrice >= voucher.minOrderAmount;

        if (isValidDate && hasLimit && meetsMinOrder) {
          appliedVoucherId = voucher._id;
          if (voucher.discountType === 'PERCENTAGE') {
            discount = Math.round((basePrice * voucher.discountValue) / 100);
            if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
              discount = voucher.maxDiscount;
            }
          } else {
            discount = Math.min(voucher.discountValue, basePrice);
          }
          // Tăng số lượt dùng voucher
          voucher.usedCount += 1;
          await voucher.save();
        }
      }
    }

    const totalAmount = Math.max(0, basePrice - discount);

    // 6. SINH MÃ ĐẶT SÂN TỰ ĐỘNG (Ví dụ: BK202610165432)
    const dateStr = bookingDateObj.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const bookingCode = `BK${dateStr}${randomSuffix}`;

    // Xác định trạng thái mặc định
    const finalStatus = bodyStatus || (req.user?.role === 'CUSTOMER' ? 'CONFIRMED' : 'CONFIRMED');
    const finalPaymentStatus = bodyPaymentStatus || (paymentMethod === 'CASH' ? 'UNPAID' : 'PAID');

    // 7. LƯU ĐƠN ĐẶT SÂN
    const newBooking = await Booking.create({
      bookingCode,
      customerId,
      courtId,
      voucherId: appliedVoucherId,
      bookingDate: bookingDateObj,
      startTime,
      endTime,
      price: basePrice,
      discount,
      totalAmount,
      paymentMethod,
      paymentStatus: finalPaymentStatus,
      status: finalStatus,
      note
    });

    // 8. TẠO THÔNG BÁO CHO HỆ THỐNG
    try {
      await Notification.create({
        recipientId: customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_SUCCESS',
        title: 'Đặt sân thành công!',
        message: `Đơn đặt sân #${bookingCode} tại ${court.courtName} lúc ${startTime} ngày ${bookingDate} đã được xác nhận.`,
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Không thể tạo thông báo:', notifErr.message);
    }

    const populated = await Booking.findById(newBooking._id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue');

    return sendSuccess(res, populated, 'Đặt sân cầu lông thành công!', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 8. Cập nhật trạng thái đơn đặt sân (Dành cho Quản trị viên / Nhân viên)
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, note } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      return sendError(res, 'Không tìm thấy đơn đặt sân!', 404);
    }

    const validStatuses = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 'Trạng thái đặt sân không hợp lệ!', 400);
    }

    // Quy tắc: Trạng thái chỉ được cập nhật đúng chiều, không được đi ngược lại
    const ALLOWED_TRANSITIONS = {
      PENDING: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
      CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
      CHECKED_IN: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
      REJECTED: []
    };

    if (status && status !== booking.status) {
      const allowedNext = ALLOWED_TRANSITIONS[booking.status] || [];
      if (!allowedNext.includes(status)) {
        return sendError(
          res,
          `Trạng thái đặt sân chỉ được cập nhật đúng chiều theo quy trình (hiện tại: ${booking.status}), không được chuyển ngược lại thành ${status}!`,
          400
        );
      }
    }

    const validPaymentStatuses = ['UNPAID', 'PAID', 'REFUNDED'];
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      return sendError(res, 'Trạng thái thanh toán không hợp lệ!', 400);
    }

    // Nếu đơn bị hủy/từ chối và trước đó có dùng voucher, hoàn lại 1 lượt dùng
    if ((status === 'CANCELLED' || status === 'REJECTED') && booking.status !== 'CANCELLED' && booking.status !== 'REJECTED' && booking.voucherId) {
      await Voucher.findByIdAndUpdate(booking.voucherId, { $inc: { usedCount: -1 } });
    }

    if (status) booking.status = status;
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    if (typeof note === 'string') booking.note = note;

    await booking.save();

    // Thông báo cho khách hàng khi trạng thái thay đổi
    try {
      if (status === 'CONFIRMED' || status === 'CANCELLED' || status === 'REJECTED') {
        await Notification.create({
          recipientId: booking.customerId,
          recipientType: 'CUSTOMER',
          type: status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : status === 'REJECTED' ? 'BOOKING_REJECTED' : 'BOOKING_CANCELLED',
          title: status === 'CONFIRMED' ? 'Đơn đặt sân đã được duyệt!' : status === 'REJECTED' ? 'Yêu cầu đặt sân đã bị từ chối' : 'Đơn đặt sân đã bị hủy',
          message:
            status === 'CONFIRMED'
              ? `Đơn đặt sân #${booking.bookingCode} đã được nhân viên duyệt thành công.`
              : status === 'REJECTED'
              ? `Đơn đặt sân #${booking.bookingCode} đã bị từ chối.`
              : `Đơn đặt sân #${booking.bookingCode} đã bị hủy.`,
          isRead: false
        });
      }
    } catch (notifErr) {
      console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
    }

    const updatedBooking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();

    return sendSuccess(res, updatedBooking, 'Cập nhật trạng thái đặt sân thành công!', 200);
  } catch (error) {
    return sendError(res, 'Không thể xử lý yêu cầu đặt sân do lỗi hệ thống. Trạng thái đặt sân chưa được thay đổi. Vui lòng thử lại sau.', 500);
  }
};

// AF1: Thay đổi thông tin đặt sân (Change Booking Information)
exports.changeBookingInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const { courtId, bookingDate, startTime, endTime, note, price } = req.body;

    // E1: Không tìm thấy yêu cầu đặt sân (Booking does not exist)
    const booking = await Booking.findById(id);
    if (!booking) {
      return sendError(
        res,
        'Không tìm thấy yêu cầu đặt sân. Vui lòng kiểm tra thông tin đặt sân và thử lại.',
        404
      );
    }

    // E2: Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận (Booking is no longer pending approval)
    if (booking.status !== 'PENDING') {
      return sendError(
        res,
        'Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận và không thể tiếp tục xử lý.',
        400
      );
    }

    const targetCourtId = courtId || booking.courtId;
    const targetBookingDate = bookingDate ? new Date(bookingDate) : booking.bookingDate;
    const targetStartTime = startTime || booking.startTime;
    const targetEndTime = endTime || booking.endTime;

    // E3: Kiểm tra sân đã chọn có khả dụng không
    const court = await Court.findById(targetCourtId);
    if (!court || court.status !== 'ACTIVE') {
      return sendError(
        res,
        'Sân đã chọn không còn khả dụng cho yêu cầu đặt sân này. Vui lòng chọn sân khác hoặc phương án đặt sân khác.',
        400
      );
    }

    // E3: Kiểm tra trùng lịch với đơn khác tại cùng sân, ngày và giờ
    const startOfDay = new Date(targetBookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetBookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const conflictingBooking = await Booking.findOne({
      _id: { $ne: booking._id },
      courtId: targetCourtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      startTime: targetStartTime,
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    });

    if (conflictingBooking) {
      return sendError(
        res,
        'Sân đã chọn không còn khả dụng cho yêu cầu đặt sân này. Vui lòng chọn sân khác hoặc phương án đặt sân khác.',
        400
      );
    }

    // Tính toán lại giá tiền từ bảng giá (Price) theo sân và khung giờ mới
    const dayOfWeek = new Date(targetBookingDate).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    let basePrice = 0;
    const priceDoc = await Price.findOne({
      courtId: targetCourtId,
      dayType,
      timeSlot: { $regex: targetStartTime },
      status: 'ACTIVE'
    });

    if (price && Number(price) > 0) {
      basePrice = Number(price);
    } else if (priceDoc) {
      basePrice = priceDoc.price;
    } else {
      basePrice = isWeekend ? 140000 : 100000;
    }

    // Tính toán lại voucher nếu có
    let discount = 0;
    if (booking.voucherId) {
      const voucher = await Voucher.findById(booking.voucherId);
      if (voucher) {
        if (voucher.discountType === 'PERCENTAGE') {
          discount = Math.round((basePrice * voucher.discountValue) / 100);
          if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
            discount = voucher.maxDiscount;
          }
        } else {
          discount = Math.min(voucher.discountValue, basePrice);
        }
      }
    }

    const totalAmount = Math.max(0, basePrice - discount);

    // Cập nhật thông tin đơn
    booking.courtId = targetCourtId;
    booking.bookingDate = targetBookingDate;
    booking.startTime = targetStartTime;
    booking.endTime = targetEndTime;
    booking.price = basePrice;
    booking.discount = discount;
    booking.totalAmount = totalAmount;
    if (typeof note === 'string') booking.note = note;

    await booking.save();

    // E4: Gửi thông báo đến khách hàng
    let notificationSent = true;
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_UPDATED',
        title: 'Thông tin đặt sân đã được cập nhật',
        message: `Đơn đặt sân #${booking.bookingCode} đã được cập nhật sang sân ${court.courtName}, ngày ${new Date(targetBookingDate).toLocaleDateString('vi-VN')}, khung giờ ${targetStartTime} - ${targetEndTime}.`,
        isRead: false
      });
    } catch (notifErr) {
      notificationSent = false;
    }

    const updatedBooking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();

    if (!notificationSent) {
      return sendSuccess(
        res,
        updatedBooking,
        'Yêu cầu đặt sân đã được xử lý thành công, nhưng không thể gửi thông báo.',
        200
      );
    }

    return sendSuccess(res, updatedBooking, 'Thay đổi thông tin đặt sân thành công!', 200);
  } catch (error) {
    // E5: Lỗi hệ thống trong quá trình xử lý yêu cầu đặt sân
    return sendError(
      res,
      'Không thể xử lý yêu cầu đặt sân do lỗi hệ thống. Trạng thái đặt sân chưa được thay đổi. Vui lòng thử lại sau.',
      500
    );
  }
};

// AF2: Từ chối yêu cầu đặt sân (Reject Booking)
exports.rejectBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = '' } = req.body;

    // E1: Không tìm thấy yêu cầu đặt sân (Booking does not exist)
    const booking = await Booking.findById(id);
    if (!booking) {
      return sendError(
        res,
        'Không tìm thấy yêu cầu đặt sân. Vui lòng kiểm tra thông tin đặt sân và thử lại.',
        404
      );
    }

    // E2: Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận (Booking is no longer pending approval)
    if (booking.status !== 'PENDING') {
      return sendError(
        res,
        'Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận và không thể tiếp tục xử lý.',
        400
      );
    }

    // Cập nhật trạng thái thành REJECTED
    booking.status = 'REJECTED';
    if (reason && reason.trim()) {
      booking.note = booking.note
        ? `${booking.note} | Lý do từ chối: ${reason.trim()}`
        : `Lý do từ chối: ${reason.trim()}`;
    }

    // Nếu đơn có dùng voucher, hoàn lại 1 lượt dùng
    if (booking.voucherId) {
      await Voucher.findByIdAndUpdate(booking.voucherId, { $inc: { usedCount: -1 } });
    }

    await booking.save();

    // E4: Gửi thông báo từ chối đến Khách hàng
    let notificationSent = true;
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_REJECTED',
        title: 'Yêu cầu đặt sân đã bị từ chối',
        message: `Yêu cầu đặt sân #${booking.bookingCode} của bạn đã bị từ chối.${reason ? ' Lý do: ' + reason.trim() : ''}`,
        isRead: false
      });
    } catch (notifErr) {
      notificationSent = false;
    }

    const updatedBooking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();

    if (!notificationSent) {
      return sendSuccess(
        res,
        updatedBooking,
        'Yêu cầu đặt sân đã được xử lý thành công, nhưng không thể gửi thông báo.',
        200
      );
    }

    return sendSuccess(res, updatedBooking, 'Từ chối yêu cầu đặt sân thành công!', 200);
  } catch (error) {
    // E5: Lỗi hệ thống trong quá trình xử lý yêu cầu đặt sân
    return sendError(
      res,
      'Không thể xử lý yêu cầu đặt sân do lỗi hệ thống. Trạng thái đặt sân chưa được thay đổi. Vui lòng thử lại sau.',
      500
    );
  }
};
