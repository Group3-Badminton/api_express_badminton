const Booking = require('../models/booking');
const Court = require('../models/court');
const User = require('../models/user');
const { sendSuccess, sendError } = require('../utils/response');

// 1. Lấy danh sách booking (Hỗ trợ tìm kiếm, lọc theo ngày, trạng thái, sân, phân trang)
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

    // Tìm kiếm theo từ khóa (Mã đơn hoặc tìm User trước)
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

    // Thực thi truy vấn danh sách
    const [bookings, totalRecords] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email phone')
        .populate('courtId', 'courtName courtType location')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(filter)
    ]);

    // Thống kê nhanh theo các trạng thái (cho badge tổng quan)
    const [
      totalAll,
      pendingCount,
      confirmedCount,
      checkedInCount,
      completedCount,
      cancelledCount,
      revenueResult
    ] = await Promise.all([
      Booking.countDocuments({}),
      Booking.countDocuments({ status: 'PENDING' }),
      Booking.countDocuments({ status: 'CONFIRMED' }),
      Booking.countDocuments({ status: 'CHECKED_IN' }),
      Booking.countDocuments({ status: 'COMPLETED' }),
      Booking.countDocuments({ status: 'CANCELLED' }),
      Booking.aggregate([
        {
          $match: {
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
      .lean();

    if (!booking) {
      return sendError(res, 'Không tìm thấy thông tin đơn đặt sân!', 404);
    }

    return sendSuccess(res, booking, 'Lấy chi tiết đơn đặt sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 3. Cập nhật trạng thái đơn đặt sân (Dành cho Admin/Staff)
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, note } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      return sendError(res, 'Không tìm thấy đơn đặt sân!', 404);
    }

    const validStatuses = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 'Trạng thái không hợp lệ!', 400);
    }

    const validPaymentStatuses = ['UNPAID', 'PAID', 'REFUNDED'];
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      return sendError(res, 'Trạng thái thanh toán không hợp lệ!', 400);
    }

    if (status) booking.status = status;
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    if (typeof note === 'string') booking.note = note;

    await booking.save();

    const updatedBooking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone')
      .populate('courtId', 'courtName courtType location')
      .lean();

    return sendSuccess(res, updatedBooking, 'Cập nhật trạng thái đặt sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 4. Tạo đơn đặt sân mới (Hỗ trợ Admin đặt trực tiếp hoặc Test)
exports.createBooking = async (req, res) => {
  try {
    const {
      customerId,
      courtId,
      bookingDate,
      startTime,
      endTime,
      price = 0,
      discount = 0,
      totalAmount = 0,
      paymentMethod = 'CASH',
      paymentStatus = 'PAID',
      status = 'CONFIRMED',
      note = ''
    } = req.body;

    if (!customerId || !courtId || !bookingDate || !startTime || !endTime) {
      return sendError(res, 'Vui lòng cung cấp đầy đủ thông tin đặt sân!', 400);
    }

    // Sinh mã đặt sân tự động BK + YYYYMMDD + 4 số ngẫu nhiên
    const dateStr = new Date(bookingDate).toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const bookingCode = `BK${dateStr}${randomSuffix}`;

    const newBooking = await Booking.create({
      bookingCode,
      customerId,
      courtId,
      bookingDate: new Date(bookingDate),
      startTime,
      endTime,
      price: Number(price) || 0,
      discount: Number(discount) || 0,
      totalAmount: Number(totalAmount) || Number(price) - Number(discount),
      paymentMethod,
      paymentStatus,
      status,
      note
    });

    const populated = await Booking.findById(newBooking._id)
      .populate('customerId', 'fullName email phone')
      .populate('courtId', 'courtName courtType location');

    return sendSuccess(res, populated, 'Tạo đơn đặt sân thành công!', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// 5. Lấy danh sách sân bóng để phục vụ bộ lọc
exports.getCourts = async (req, res) => {
  try {
    const courts = await Court.find({}).select('_id courtName courtType location status').lean();
    return sendSuccess(res, courts, 'Lấy danh sách sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};
