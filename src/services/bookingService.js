const mongoose = require('mongoose');
const Booking = require('../models/booking');
const Court = require('../models/court');
const User = require('../models/user');
const TimeSlot = require('../models/timeSlot');
const Price = require('../models/price');
const PriceRule = require('../models/priceRule');
const Voucher = require('../models/voucher');
const Notification = require('../models/notification');
const { canBookCourt } = require('../utils/courtValidation');

// Hàm tiện ích chuyển đổi giờ HH:mm sang phút
const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Hàm tiện ích chuyển đổi phút sang giờ HH:mm
const formatMinutesToTime = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const isPendingBooking = (status) => status === 'PENDING' || status === 'PENDING_APPROVAL';
const CUSTOMER_CANCELLATION_LIMIT = 3;
const CUSTOMER_CANCELLATION_LOCK_REASON =
  'Bạn đã đạt giới hạn 3 lần hủy đơn đặt sân đã xác nhận trong tháng. Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ mở khóa.';
const BUSINESS_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const isTransactionUnsupported = (error) =>
  error.code === 20 ||
  error.codeName === 'IllegalOperation' ||
  /transaction numbers are only allowed|does not support transactions|does not support retryable writes/i.test(error.message);

const getBusinessMonthRange = (date) => {
  const businessDate = new Date(date.getTime() + BUSINESS_TIME_ZONE_OFFSET_MS);
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - BUSINESS_TIME_ZONE_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - BUSINESS_TIME_ZONE_OFFSET_MS)
  };
};

const countMonthlyConfirmedCancellations = (history, at) => {
  const { start, end } = getBusinessMonthRange(at);
  return (history || []).filter((entry) =>
    entry.countsTowardMonthlyLimit &&
    entry.cancelledAt >= start &&
    entry.cancelledAt < end
  ).length;
};

const getBookingStartDate = (bookingDate, time) => {
  const date = new Date(bookingDate);
  if (Number.isNaN(date.getTime()) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), hours, minutes) - BUSINESS_TIME_ZONE_OFFSET_MS);
};

const getBookingOrders = (booking) => {
  if (Array.isArray(booking.items) && booking.items.length > 0) {
    return booking.items.map((item, itemIndex) => ({
      itemId: item._id?.toString(),
      itemIndex,
      courtId: item.courtId?._id || item.courtId,
      courtName: item.courtName || item.courtId?.courtName || '',
      bookingDate: item.bookingDate || booking.bookingDate,
      startTime: item.startTime,
      endTime: item.endTime,
      status: item.status || 'ACTIVE',
      price: item.price,
      intervals: item.intervals || []
    }));
  }
  return [{
    itemIndex: 0,
    courtId: booking.courtId?._id || booking.courtId,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    price: booking.price,
    intervals: []
  }];
};

const getActiveBookingOrders = (booking) =>
  getBookingOrders(booking).filter((order) => order.status !== 'CANCELLED');

const getBookingTotalsForActiveItems = (booking, cancelledItemIds = []) => {
  const cancelledItems = new Set(cancelledItemIds.map(String));
  const activeItems = Array.isArray(booking.items)
    ? booking.items.filter((item) =>
      item.status !== 'CANCELLED' && !cancelledItems.has(item._id.toString())
    )
    : [];
  const price = activeItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const discount = Math.min(Math.max(0, Number(booking.discount) || 0), price);
  return {
    price,
    discount,
    totalAmount: Math.max(0, price - discount)
  };
};

class BookingService {
  async lockCourts(courtIds, session, lease) {
    if (!session && lease) {
      await lease.lockMore(courtIds);
      return;
    }
    if (!session) {
      throw new Error('A MongoDB session or booking lease is required to acquire booking locks.');
    }
    for (const courtId of [...new Set(courtIds.map(String))].sort()) {
      const lock = await Court.updateOne(
        { _id: courtId, status: 'ACTIVE' },
        { $inc: { bookingVersion: 1 } },
        { session }
      );
      if (lock.matchedCount === 0) {
        const err = new Error('Một hoặc nhiều sân không còn hoạt động hoặc không tồn tại.');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  async withCourtLocks(courtIds, operation) {
    const session = await Booking.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        await this.lockCourts(courtIds, session);
        result = await operation(session, null);
      });
      return result;
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.withCourtLeases(courtIds, operation);
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async withCourtLeases(courtIds, operation) {
    const token = require('crypto').randomUUID();
    const acquiredCourtIds = new Set();
    const acquire = async (ids) => {
      const sortedIds = [...new Set(ids.map(String))].sort();
      for (const courtId of sortedIds) {
        if (acquiredCourtIds.has(courtId)) continue;
        let acquired = false;
        for (let attempt = 0; attempt < 100 && !acquired; attempt += 1) {
          const now = new Date();
          const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000);
          const court = await Court.findOneAndUpdate(
            {
              _id: courtId,
              status: 'ACTIVE',
              $or: [
                { bookingLockUntil: { $exists: false } },
                { bookingLockUntil: { $lte: now } },
                { bookingLockToken: token, bookingLockUntil: { $gt: now } }
              ]
            },
            {
              $set: { bookingLockToken: token, bookingLockUntil: leaseUntil },
              $inc: { bookingVersion: 1 }
            },
            { returnDocument: 'after' }
          ).select('_id').lean();
          if (court) {
            acquiredCourtIds.add(courtId);
            acquired = true;
            continue;
          }

          const existingCourt = await Court.findById(courtId).select('status').lean();
          if (!existingCourt || existingCourt.status !== 'ACTIVE') {
            const err = new Error('Một hoặc nhiều sân không còn hoạt động hoặc không tồn tại.');
            err.statusCode = 400;
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!acquired) {
          const err = new Error('Lịch sân đang được cập nhật bởi yêu cầu khác. Vui lòng thử lại.');
          err.statusCode = 409;
          throw err;
        }
      }
    };

    const lease = {
      lockMore: acquire,
      ensure: async () => {
        const now = new Date();
        const result = await Court.updateMany(
          {
            bookingLockToken: token,
            bookingLockUntil: { $gt: now }
          },
          { $set: { bookingLockUntil: new Date(now.getTime() + 5 * 60 * 1000) } }
        );
        if (result.matchedCount !== acquiredCourtIds.size) {
          const err = new Error('Không thể bảo vệ lịch sân khỏi yêu cầu đồng thời. Vui lòng thử lại.');
          err.statusCode = 409;
          throw err;
        }
      }
    };

    try {
      await acquire(courtIds);
      return await operation(null, lease);
    } finally {
      if (acquiredCourtIds.size > 0) {
        await Court.updateMany(
          { bookingLockToken: token },
          { $unset: { bookingLockToken: 1, bookingLockUntil: 1 } }
        );
      }
    }
  }

  async assertOrdersAvailable(orders, bookingDate, excludeBookingId, session) {
    if (!Array.isArray(orders) || orders.length === 0) {
      const err = new Error('Ngày đặt sân, sân và khung giờ không hợp lệ.');
      err.statusCode = 400;
      throw err;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ordersByCourt = new Map();

    for (const order of orders) {
      const date = new Date(order.bookingDate || bookingDate);
      if (
        !order.courtId ||
        !mongoose.Types.ObjectId.isValid(order.courtId) ||
        !order.bookingDate && !bookingDate ||
        Number.isNaN(date.getTime()) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.startTime || '') ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.endTime || '') ||
        parseTimeToMinutes(order.startTime) >= parseTimeToMinutes(order.endTime)
      ) {
        const err = new Error('Một hoặc nhiều khung giờ không hợp lệ.');
        err.statusCode = 400;
        throw err;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      if (startOfDay < today) {
        const err = new Error('Không thể đặt hoặc xác nhận sân cho ngày trong quá khứ.');
        err.statusCode = 400;
        throw err;
      }
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      order.bookingDate = date;

      const key = `${order.courtId.toString()}:${startOfDay.toISOString().slice(0, 10)}`;
      const courtOrders = ordersByCourt.get(key) || [];
      if (courtOrders.some((existing) =>
        existing.startTime < order.endTime && existing.endTime > order.startTime
      )) {
        const err = new Error('Đơn có các khung giờ bị trùng trên cùng một sân.');
        err.statusCode = 400;
        throw err;
      }
      courtOrders.push(order);
      ordersByCourt.set(key, courtOrders);
    }

    const courtIds = [...new Set(orders.map((order) => order.courtId.toString()))];
    let courtQuery = Court.find({ _id: { $in: courtIds }, status: 'ACTIVE' })
      .select('_id courtName status openingTime closingTime');
    if (session) courtQuery = courtQuery.session(session);
    const courts = await courtQuery.lean();
    if (courts.length !== courtIds.length) {
      const err = new Error('Một hoặc nhiều sân trong đơn không còn hoạt động hoặc không tồn tại.');
      err.statusCode = 400;
      throw err;
    }
    const courtMap = new Map(courts.map((court) => [court._id.toString(), court]));

    for (const order of orders) {
      const court = courtMap.get(order.courtId.toString());
      const courtEligibility = canBookCourt(court, order.startTime, order.endTime);
      if (!courtEligibility.canBook) {
        const err = new Error(courtEligibility.reason);
        err.statusCode = 400;
        throw err;
      }
      const startOfDay = new Date(order.bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(order.bookingDate);
      endOfDay.setHours(23, 59, 59, 999);
      const conflictQuery = this.getScheduleConflictQuery(order, startOfDay, endOfDay, excludeBookingId);
      let conflictQueryBuilder = Booking.findOne(conflictQuery).select('_id');
      if (session) conflictQueryBuilder = conflictQueryBuilder.session(session);
      const conflict = await conflictQueryBuilder.lean();
      if (conflict) {
        const err = new Error(`Khung giờ ${order.startTime}-${order.endTime} tại ${court?.courtName || 'sân'} không còn khả dụng.`);
        err.statusCode = 409;
        throw err;
      }
    }
  }

  getScheduleConflictQuery(order, startOfDay, endOfDay, excludeBookingId = null) {
    const itemSchedule = {
      courtId: order.courtId,
      status: { $ne: 'CANCELLED' },
      startTime: { $lt: order.endTime },
      endTime: { $gt: order.startTime }
    };
    return {
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      $or: [
        {
          items: {
            $elemMatch: {
              ...itemSchedule,
              bookingDate: { $gte: startOfDay, $lte: endOfDay }
            }
          }
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          items: { $elemMatch: { ...itemSchedule, bookingDate: { $exists: false } } }
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          $or: [{ items: { $exists: false } }, { items: { $size: 0 } }],
          courtId: order.courtId,
          startTime: { $lt: order.endTime },
          endTime: { $gt: order.startTime }
        }
      ]
    };
  }

  async addAdminConflictWarnings(bookings) {
    for (const booking of bookings) {
      const activeOrders = getActiveBookingOrders(booking);
      const warnings = [];
      for (let index = 0; index < activeOrders.length; index += 1) {
        const order = activeOrders[index];
        const orderDate = new Date(order.bookingDate || booking.bookingDate);
        const startOfDay = new Date(orderDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(orderDate);
        endOfDay.setHours(23, 59, 59, 999);
        const orderCourtId = order.courtId?._id || order.courtId;
        const overlaps = (other) =>
          String(other.courtId?._id || other.courtId) === String(orderCourtId) &&
          new Date(other.bookingDate || booking.bookingDate).getTime() === orderDate.getTime() &&
          other.startTime < order.endTime &&
          other.endTime > order.startTime &&
          other.status !== 'CANCELLED';

        const internalConflict = activeOrders.slice(index + 1).find(overlaps);
        if (internalConflict) {
          warnings.push({
            itemId: order.itemId,
            courtName: order.courtName || '',
            bookingDate: orderDate,
            startTime: order.startTime,
            endTime: order.endTime,
            conflictingBookingCode: booking.bookingCode
          });
          continue;
        }

        const conflictQuery = this.getScheduleConflictQuery(
          { ...order, courtId: orderCourtId },
          startOfDay,
          endOfDay,
          booking._id
        );
        const candidates = await Booking.find(conflictQuery)
          .select('bookingCode bookingDate startTime endTime courtId items')
          .lean();
        const conflict = candidates.find((candidate) => {
          const candidateOrders = getActiveBookingOrders(candidate);
          return candidateOrders.some((candidateOrder) => overlaps({
            ...candidateOrder,
            bookingDate: candidateOrder.bookingDate || candidate.bookingDate
          }));
        });
        if (conflict) {
          warnings.push({
            itemId: order.itemId,
            courtName: order.courtName || '',
            bookingDate: orderDate,
            startTime: order.startTime,
            endTime: order.endTime,
            conflictingBookingCode: conflict.bookingCode
          });
        }
      }
      booking.conflictWarnings = warnings;
    }
    return bookings;
  }

  /**
   * 1. Lấy danh sách booking (tìm kiếm, lọc theo ngày/trạng thái/sân/phân trang, thống kê)
   */
  async getAllBookings(queryParams = {}, currentUser = null) {
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
    } = queryParams;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Khách hàng thường chỉ xem đơn của chính họ
    if (currentUser && currentUser.role === 'CUSTOMER') {
      filter.customerId = currentUser.userId || currentUser._id;
    } else if (customerId) {
      filter.customerId = customerId;
    }

    // Lọc theo trạng thái đặt sân (chuẩn hóa hỗ trợ cả PENDING và PENDING_APPROVAL)
    if (status && status !== 'ALL') {
      if (status === 'PENDING' || status === 'PENDING_APPROVAL') {
        filter.status = { $in: ['PENDING', 'PENDING_APPROVAL'] };
      } else {
        filter.status = status;
      }
    }

    // Lọc theo trạng thái thanh toán
    if (paymentStatus && paymentStatus !== 'ALL') {
      filter.paymentStatus = paymentStatus;
    }

    // Lọc theo sân
    if (courtId && courtId !== 'ALL') {
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [
        { courtId: courtId },
        { 'items.courtId': courtId }
      ] });
    }

    // Lọc theo ngày đặt sân
    if (bookingDate) {
      const start = new Date(bookingDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(bookingDate);
      end.setHours(23, 59, 59, 999);
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [
        { bookingDate: { $gte: start, $lte: end } },
        { items: { $elemMatch: { bookingDate: { $gte: start, $lte: end } } } }
      ] });
    } else if (startDate || endDate) {
      const dateRange = {};
      if (startDate) {
        dateRange.$gte = new Date(startDate);
        dateRange.$gte.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        dateRange.$lte = new Date(endDate);
        dateRange.$lte.setHours(23, 59, 59, 999);
      }
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [
        { bookingDate: dateRange },
        { items: { $elemMatch: { bookingDate: dateRange } } }
      ] });
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

      filter.$and = filter.$and || [];
      filter.$and.push({ $or: [
        { bookingCode: { $regex: keyword, $options: 'i' } },
        { customerId: { $in: userIds } }
      ] });
    }

    // Sắp xếp
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Thực thi truy vấn danh sách bookings
    const [bookings, totalRecords] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email phone address')
        .populate('courtId', 'courtName courtType location description')
        .populate('items.courtId', 'courtName courtType location description')
        .populate('voucherId', 'voucherCode voucherName discountType discountValue maxDiscount')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(filter)
    ]);
    if (currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF') {
      await this.addAdminConflictWarnings(bookings);
    }

    // Thống kê nhanh theo các trạng thái
    const statsFilter = currentUser && currentUser.role === 'CUSTOMER'
      ? { customerId: currentUser.userId || currentUser._id }
      : {};

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
      Booking.countDocuments({ ...statsFilter, status: { $in: ['PENDING', 'PENDING_APPROVAL'] } }),
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

    return {
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
    };
  }

  /**
   * 2. Lấy chi tiết đơn đặt sân theo ID
   */
  async getBookingById(id, currentUser = null) {
    const booking = await Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('items.courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue maxDiscount')
      .lean();

    if (!booking) {
      const err = new Error('Không tìm thấy thông tin đơn đặt sân!');
      err.statusCode = 404;
      throw err;
    }

    // Bảo mật: Nếu là khách hàng, chỉ được xem đơn của chính mình
    if (currentUser && currentUser.role === 'CUSTOMER') {
      const customerObjId = booking.customerId?._id?.toString() || booking.customerId?.toString();
      const currentUserId = currentUser.userId?.toString() || currentUser._id?.toString();
      if (customerObjId !== currentUserId) {
        const err = new Error('Bạn không có quyền truy cập vào đơn đặt sân này!');
        err.statusCode = 403;
        throw err;
      }
    }

    if (currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF') {
      return (await this.addAdminConflictWarnings([booking]))[0];
    }
    return booking;
  }

  /**
   * 3. Lấy danh sách sân thi đấu
   */
  async getCourts() {
    return Court.find({ status: 'ACTIVE' })
      .select('_id courtName courtType location description status')
      .lean();
  }

  /**
   * 4. Lấy danh sách khung giờ thi đấu
   */
  async getTimeSlots() {
    return TimeSlot.find({ status: 'ACTIVE' })
      .sort({ startTime: 1 })
      .lean();
  }

  /**
   * 5. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày
   */
  async getCourtAvailability(courtId, bookingDate, currentUser = null) {
    if (!courtId || !bookingDate) {
      const err = new Error('Vui lòng cung cấp mã sân (courtId) và ngày đặt (bookingDate)!');
      err.statusCode = 400;
      throw err;
    }

    const court = await Court.findById(courtId);
    if (!court) {
      const err = new Error('Không tìm thấy thông tin sân cầu lông!');
      err.statusCode = 404;
      throw err;
    }

    const dateObj = new Date(bookingDate);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    const [timeSlots, prices, priceRules] = await Promise.all([
      TimeSlot.find({ status: 'ACTIVE' }).sort({ startTime: 1 }).lean(),
      Price.find({
        courtId,
        dayType,
        status: 'ACTIVE'
      }).lean(),
      PriceRule.find({
        status: 'ACTIVE',
        daysOfWeek: dayOfWeek
      }).lean()
    ]);

    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const activeBookings = await Booking.find({
      status: { $nin: ['CANCELLED', 'REJECTED'] },
      $or: [
        {
          items: {
            $elemMatch: {
              status: { $ne: 'CANCELLED' },
              courtId,
              bookingDate: { $gte: startOfDay, $lte: endOfDay }
            }
          }
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          items: { $elemMatch: { courtId, status: { $ne: 'CANCELLED' }, bookingDate: { $exists: false } } }
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          courtId,
          $or: [{ items: { $exists: false } }, { items: { $size: 0 } }]
        }
      ]
    }).select('courtId bookingDate startTime endTime bookingCode status items').lean();

    const courtPricesMin = prices.length > 0 ? Math.min(...prices.map((p) => p.price)) : null;
    const candidateRules = priceRules.filter((r) =>
      r.courtType === 'ALL' || (court.courtType && court.courtType.toUpperCase().includes(r.courtType))
    );
    const dbDefaultPrice = candidateRules.length > 0
      ? Math.min(...candidateRules.map((r) => r.pricePerHour))
      : (priceRules.length > 0 ? Math.min(...priceRules.map((r) => r.pricePerHour)) : null);
    const defaultPrice = courtPricesMin || dbDefaultPrice || 0;

    const slotDetails = timeSlots.map((slot) => {
      const priceDoc = prices.find(
        (p) =>
          (p.timeSlotId && p.timeSlotId.toString() === slot._id.toString()) ||
          p.timeSlot.includes(slot.startTime)
      );

      let slotPrice;
      if (priceDoc) {
        slotPrice = priceDoc.price;
      } else {
        const matchedRule = priceRules.find((r) => {
          const typeMatches = r.courtType === 'ALL' ||
            (court.courtType && court.courtType.toUpperCase().includes(r.courtType));
          return typeMatches && r.startTime <= slot.startTime && r.endTime >= slot.endTime;
        });
        slotPrice = matchedRule ? matchedRule.pricePerHour : defaultPrice;
      }

      const bookedBooking = activeBookings.find((b) => {
        if (Array.isArray(b.items) && b.items.length > 0) {
          return b.items.some((item) => {
            if (item.status === 'CANCELLED') return false;
            const itemCourtId = item.courtId?._id?.toString() || item.courtId?.toString();
            const itemDate = new Date(item.bookingDate || b.bookingDate);
            if (
              itemCourtId === courtId.toString() &&
              itemDate >= startOfDay &&
              itemDate <= endOfDay
            ) {
              return item.startTime < slot.endTime && item.endTime > slot.startTime;
            }
            return false;
          });
        }
        const bCourtId = b.courtId?._id?.toString() || b.courtId?.toString();
        if (bCourtId === courtId.toString()) {
          return b.startTime < slot.endTime && b.endTime > slot.startTime;
        }
        return false;
      });

      const slotDetail = {
        timeSlotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slot.label || `${slot.startTime} - ${slot.endTime}`,
        price: slotPrice,
        dayType,
        isBooked: !!bookedBooking
      };
      if (currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF') {
        slotDetail.bookingCode = bookedBooking ? bookedBooking.bookingCode : null;
      }
      return slotDetail;
    });

    return {
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
    };
  }

  /**
   * 6. Kiểm tra và áp dụng mã giảm giá (Voucher)
   */
  async validateVoucher(voucherCode, orderAmount = 0) {
    if (!voucherCode) {
      const err = new Error('Vui lòng cung cấp mã voucher!');
      err.statusCode = 400;
      throw err;
    }

    const code = voucherCode.trim().toUpperCase();
    const voucher = await Voucher.findOne({
      $or: [{ voucherCode: code }, { code }],
      status: 'ACTIVE'
    });

    if (!voucher) {
      const err = new Error('Mã giảm giá không tồn tại hoặc đã bị khóa!');
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    if (voucher.startDate && now < new Date(voucher.startDate)) {
      const err = new Error('Mã giảm giá chưa đến thời gian áp dụng!');
      err.statusCode = 400;
      throw err;
    }

    if (voucher.endDate && now > new Date(voucher.endDate)) {
      const err = new Error('Mã giảm giá đã hết hạn sử dụng!');
      err.statusCode = 400;
      throw err;
    }

    if (voucher.usageLimit > 0 && voucher.usedCount >= voucher.usageLimit) {
      const err = new Error('Mã giảm giá đã hết lượt sử dụng!');
      err.statusCode = 400;
      throw err;
    }

    const currentAmount = Number(orderAmount) || 0;
    const minAmount = voucher.minOrderAmount ?? voucher.minInvoiceAmount ?? 0;
    if (minAmount > 0 && currentAmount < minAmount) {
      const err = new Error(
        `Đơn đặt sân phải có giá trị tối thiểu từ ${minAmount.toLocaleString('vi-VN')}đ để sử dụng mã này!`
      );
      err.statusCode = 400;
      throw err;
    }

    let discount = 0;
    const maxDiscount = voucher.maxDiscount ?? voucher.maxDiscountAmount ?? 0;
    if (voucher.discountType === 'PERCENTAGE') {
      discount = Math.round((currentAmount * voucher.discountValue) / 100);
      if (maxDiscount > 0 && discount > maxDiscount) {
        discount = maxDiscount;
      }
    } else {
      discount = Math.min(voucher.discountValue, currentAmount);
    }

    const finalAmount = Math.max(0, currentAmount - discount);

    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode || voucher.code,
      voucherName: voucher.voucherName || voucher.name,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discount,
      finalAmount
    };
  }

  /**
   * 6.5. Tính giá chi tiết cho từng sân và từng khung giờ (hỗ trợ mỗi sân một khung giờ khác nhau)
   */
  async calculateBookingPrice(calcData) {
    const {
      courtId,
      courtIds,
      courtOrders,
      bookingDate,
      startTime,
      endTime,
      voucherCode,
      existingVoucherId
    } = calcData;

    // Chuẩn hóa danh sách các sân và khung giờ tương ứng của từng sân
    let targetOrders = [];
    if (Array.isArray(courtOrders) && courtOrders.length > 0) {
      targetOrders = courtOrders.map((order) => order || {});
    } else {
      const targetCourtIds = Array.isArray(courtIds) && courtIds.length > 0
        ? courtIds
        : (courtId ? [courtId] : []);
      if (startTime && endTime) {
        targetOrders = targetCourtIds.map((cId) => ({
          courtId: cId,
          startTime,
          endTime
        }));
      }
    }

    if (targetOrders.length === 0) {
      return {
        courtBreakdowns: [],
        totalBasePrice: 0,
        discount: 0,
        finalTotalAmount: 0,
        appliedVoucher: null
      };
    }
    if (targetOrders.some((order) =>
      !order.courtId ||
      !mongoose.Types.ObjectId.isValid(order.courtId) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.startTime || '') ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.endTime || '') ||
      parseTimeToMinutes(order.startTime) >= parseTimeToMinutes(order.endTime)
    )) {
      const err = new Error('Một hoặc nhiều sân hoặc khung giờ không hợp lệ.');
      err.statusCode = 400;
      throw err;
    }

    const uniqueCourtIds = [...new Set(targetOrders.map((o) => o.courtId.toString()))];
    const courts = await Court.find({ _id: { $in: uniqueCourtIds } }).lean();
    const courtMap = new Map(courts.map((c) => [c._id.toString(), c]));

    const dayTypeForOrder = (order) => {
      const orderDate = new Date(order.bookingDate || bookingDate || Date.now());
      const dayOfWeek = orderDate.getDay();
      return dayOfWeek === 0 || dayOfWeek === 6 ? 'WEEKEND' : 'WEEKDAY';
    };
    const priceDateConditions = targetOrders.map((order) => {
      const date = new Date(order.bookingDate || bookingDate || Date.now());
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      return {
        dayType: dayTypeForOrder(order),
        $and: [
          { $or: [{ effectiveFrom: { $lte: endOfDay } }, { effectiveFrom: { $exists: false } }] },
          { $or: [{ effectiveTo: { $gte: startOfDay } }, { effectiveTo: null }, { effectiveTo: { $exists: false } }] }
        ]
      };
    });

    const [allPrices, allPriceRules, allTimeSlots] = await Promise.all([
      Price.find({
        courtId: { $in: uniqueCourtIds },
        status: 'ACTIVE',
        $or: priceDateConditions
      }).populate('timeSlotId').lean(),
      PriceRule.find({ status: 'ACTIVE' }).lean(),
      TimeSlot.find({ status: 'ACTIVE' }).sort({ startTime: 1 }).lean()
    ]);

    const courtBreakdowns = [];

    for (const order of targetOrders) {
      const court = courtMap.get(order.courtId.toString());
      if (!court) continue;

      const bStart = parseTimeToMinutes(order.startTime);
      const bEnd = parseTimeToMinutes(order.endTime);
      if (bEnd <= bStart) continue;

      const cIdStr = court._id.toString();
      const dayType = dayTypeForOrder(order);
      const isWeekend = dayType === 'WEEKEND';
      const orderDate = new Date(order.bookingDate || bookingDate || Date.now());
      const orderStartOfDay = new Date(orderDate);
      orderStartOfDay.setHours(0, 0, 0, 0);
      const orderEndOfDay = new Date(orderDate);
      orderEndOfDay.setHours(23, 59, 59, 999);
      const courtPrices = allPrices.filter((p) =>
        p.courtId.toString() === cIdStr &&
        p.dayType === dayType &&
        (!p.effectiveFrom || new Date(p.effectiveFrom) <= orderEndOfDay) &&
        (!p.effectiveTo || new Date(p.effectiveTo) >= orderStartOfDay)
      );

      // Thu thập các mốc phân chia khung giá (boundaries) từ Price và PriceRule trong database
      const points = new Set([bStart, bEnd]);
      courtPrices.forEach((p) => {
        if (p.timeSlot && p.timeSlot.includes('-')) {
          const [s, e] = p.timeSlot.split('-').map((t) => t.trim());
          const sMin = parseTimeToMinutes(s);
          const eMin = parseTimeToMinutes(e);
          if (sMin > bStart && sMin < bEnd) points.add(sMin);
          if (eMin > bStart && eMin < bEnd) points.add(eMin);
        }
      });
      allPriceRules.forEach((r) => {
        if (r.startTime && r.endTime) {
          const sMin = parseTimeToMinutes(r.startTime);
          const eMin = parseTimeToMinutes(r.endTime);
          if (sMin > bStart && sMin < bEnd) points.add(sMin);
          if (eMin > bStart && eMin < bEnd) points.add(eMin);
        }
      });

      const sortedPoints = Array.from(points).sort((a, b) => a - b);
      const rawIntervals = [];

      // Xác định đơn giá cơ sở động từ bảng giá Price của sân hoặc PriceRule trong database
      const courtPricesMin = courtPrices.length > 0 ? Math.min(...courtPrices.map((p) => p.price)) : null;
      const candidateRules = allPriceRules.filter((r) => {
        const typeMatches = r.courtType === 'ALL' ||
          (court.courtType && court.courtType.toUpperCase().includes(r.courtType));
        const dayOfWeek = orderDate.getDay();
        return typeMatches && Array.isArray(r.daysOfWeek) && r.daysOfWeek.includes(dayOfWeek);
      });
      const dbBaseRate = candidateRules.length > 0
        ? Math.min(...candidateRules.map((r) => r.pricePerHour))
        : null;
      const systemBaseRate = allPrices.length > 0 ? Math.min(...allPrices.map((p) => p.price)) : 0;
      const defaultRate = courtPricesMin || dbBaseRate || systemBaseRate;

      for (let i = 0; i < sortedPoints.length - 1; i++) {
        const intStart = sortedPoints[i];
        const intEnd = sortedPoints[i + 1];
        const durMin = intEnd - intStart;
        const durHours = durMin / 60;
        const midPoint = (intStart + intEnd) / 2;

        const matchedPrice = courtPrices.find((p) => {
          if (!p.timeSlot || !p.timeSlot.includes('-')) return false;
          const [s, e] = p.timeSlot.split('-').map((t) => t.trim());
          return parseTimeToMinutes(s) <= midPoint && parseTimeToMinutes(e) >= midPoint;
        });

        let hourlyRate;
        let matchedRule = null;
        if (matchedPrice) {
          hourlyRate = matchedPrice.price;
        } else {
          matchedRule = allPriceRules.find((r) => {
            const typeMatches = r.courtType === 'ALL' ||
              (court.courtType && court.courtType.toUpperCase().includes(r.courtType));
            const dayOfWeek = orderDate.getDay();
            return typeMatches &&
              Array.isArray(r.daysOfWeek) &&
              r.daysOfWeek.includes(dayOfWeek) &&
              parseTimeToMinutes(r.startTime) <= midPoint &&
              parseTimeToMinutes(r.endTime) >= midPoint;
          });
          hourlyRate = matchedRule ? matchedRule.pricePerHour : defaultRate;
        }

        // Tìm TimeSlot tương ứng trong DB để lấy nhãn mô tả
        const matchedSlot = (matchedPrice?.timeSlotId && typeof matchedPrice.timeSlotId === 'object')
          ? matchedPrice.timeSlotId
          : allTimeSlots.find((ts) => {
              const sMin = parseTimeToMinutes(ts.startTime);
              const eMin = parseTimeToMinutes(ts.endTime);
              return sMin <= midPoint && eMin >= midPoint;
            });

        let slotLabel = matchedSlot?.label || '';
        let slotLabelName = '';
        if (slotLabel) {
          const match = slotLabel.match(/\((.*?)\)/);
          slotLabelName = match ? match[1].trim() : slotLabel.trim();
        }

        // Nhận diện giờ cao điểm từ PriceRule / nhãn TimeSlot trong database hoặc độ chênh lệch giá so với giá cơ sở
        const ruleIsPeak = matchedRule && /vàng|cao điểm|peak/i.test(matchedRule.name + ' ' + (matchedRule.description || ''));
        const slotIsPeak = /vàng|cao điểm|peak/i.test(slotLabel);
        const isPeak = Boolean(ruleIsPeak || slotIsPeak || (!isWeekend && hourlyRate > defaultRate));

        let priceType = '';
        if (matchedRule?.name) {
          priceType = isPeak && !/cao điểm|vàng/i.test(matchedRule.name)
            ? `Giờ cao điểm (${matchedRule.name})`
            : matchedRule.name;
        } else if (slotLabelName) {
          priceType = slotLabelName;
        } else if (isPeak) {
          priceType = 'Giờ cao điểm (Giờ vàng)';
        } else if (isWeekend) {
          priceType = 'Cuối tuần';
        } else {
          priceType = 'Giờ thấp điểm (Giờ thường)';
        }
        const amount = Math.round(durHours * hourlyRate);

        rawIntervals.push({
          startTime: formatMinutesToTime(intStart),
          endTime: formatMinutesToTime(intEnd),
          durationMinutes: durMin,
          durationHours: Number(durHours.toFixed(2)),
          priceType,
          hourlyRate,
          amount
        });
      }

      // Gộp các khoảng giờ liền kề NẾU VÀ CHỈ NẾU cùng đơn giá và cùng loại giá
      const mergedIntervals = [];
      for (const inv of rawIntervals) {
        if (mergedIntervals.length > 0) {
          const prev = mergedIntervals[mergedIntervals.length - 1];
          if (prev.hourlyRate === inv.hourlyRate && prev.priceType === inv.priceType && prev.endTime === inv.startTime) {
            prev.endTime = inv.endTime;
            prev.durationMinutes += inv.durationMinutes;
            prev.durationHours = Number((prev.durationMinutes / 60).toFixed(2));
            prev.amount += inv.amount;
            continue;
          }
        }
        mergedIntervals.push({ ...inv });
      }

      const courtTotal = mergedIntervals.reduce((sum, it) => sum + it.amount, 0);

      courtBreakdowns.push({
        courtId: court._id,
        courtName: court.courtName,
        courtType: court.courtType,
        location: court.location,
        bookingDate: order.bookingDate || bookingDate,
        startTime: order.startTime,
        endTime: order.endTime,
        durationMinutes: bEnd - bStart,
        durationHours: Number(((bEnd - bStart) / 60).toFixed(2)),
        intervals: mergedIntervals,
        totalAmount: courtTotal
      });
    }

    const totalBasePrice = courtBreakdowns.reduce((sum, cb) => sum + cb.totalAmount, 0);

    // Tính Voucher
    let discount = 0;
    let appliedVoucher = null;

    if (voucherCode && voucherCode.trim()) {
      const code = voucherCode.trim().toUpperCase();
      const voucher = await Voucher.findOne({
        $or: [{ voucherCode: code }, { code }],
        status: 'ACTIVE'
      });
      if (voucher) {
        const now = new Date();
        const isValidDate = (!voucher.startDate || now >= new Date(voucher.startDate)) &&
          (!voucher.endDate || now <= new Date(voucher.endDate));
        const isExistingVoucher = existingVoucherId && voucher._id.toString() === existingVoucherId.toString();
        const hasLimit = isExistingVoucher || voucher.usageLimit <= 0 || voucher.usedCount < voucher.usageLimit;
        const minAmount = voucher.minOrderAmount ?? voucher.minInvoiceAmount ?? 0;
        const meetsMinOrder = !minAmount || totalBasePrice >= minAmount;

        if (isValidDate && hasLimit && meetsMinOrder) {
          appliedVoucher = {
            voucherId: voucher._id,
            voucherCode: voucher.voucherCode || voucher.code,
            voucherName: voucher.voucherName || voucher.name,
            discountType: voucher.discountType,
            discountValue: voucher.discountValue
          };

          const maxDiscount = voucher.maxDiscount ?? voucher.maxDiscountAmount ?? 0;
          if (voucher.discountType === 'PERCENTAGE') {
            discount = Math.round((totalBasePrice * voucher.discountValue) / 100);
            if (maxDiscount > 0 && discount > maxDiscount) {
              discount = maxDiscount;
            }
          } else {
            discount = Math.min(voucher.discountValue, totalBasePrice);
          }
        }
      }
    }

    const finalTotalAmount = Math.max(0, totalBasePrice - discount);

    return {
      courtBreakdowns,
      totalBasePrice,
      discount,
      finalTotalAmount,
      appliedVoucher
    };
  }

  /**
   * 7. Tạo mới đơn đặt sân (Hỗ trợ khách đăng nhập và khách vãng lai không cần email)
   */
  async createBooking(bookingData, currentUser = null) {
    const {
      customerId: bodyCustomerId,
      customerName,
      customerPhone,
      customerEmail,
      courtId,
      courtIds,
      courtOrders,
      bookingDate,
      startTime,
      endTime,
      voucherCode,
      voucherId: bodyVoucherId,
      paymentMethod = 'CASH',
      status: bodyStatus,
      note = ''
    } = bookingData;

    let customerId = currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF'
      ? bodyCustomerId
      : null;

    if ((currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF') && bodyCustomerId) {
      if (!mongoose.Types.ObjectId.isValid(bodyCustomerId)) {
        const err = new Error('Mã khách hàng không hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
      const targetCustomer = await User.findById(bodyCustomerId).select('_id status lockReason');
      if (!targetCustomer) {
        const err = new Error('Không tìm thấy thông tin khách hàng được chọn.');
        err.statusCode = 404;
        throw err;
      }
    }

    // Nếu người dùng đang đăng nhập với quyền CUSTOMER
    if (currentUser && currentUser.role === 'CUSTOMER') {
      customerId = currentUser.userId || currentUser._id;
      const activeCustomer = await User.findOne({
        _id: customerId,
        role: 'CUSTOMER',
        status: 'ACTIVE'
      }).select('_id');
      if (!activeCustomer) {
        const err = new Error('Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.');
        err.statusCode = 403;
        throw err;
      }
    } else if (!customerId) {
      // Trường hợp khách vãng lai hoặc đặt tại quầy
      if (customerPhone && customerPhone.trim()) {
        const cleanPhone = customerPhone.trim();
        const cleanEmail = customerEmail && customerEmail.trim()
          ? customerEmail.trim().toLowerCase()
          : undefined;

        let existingUser = await User.findOne({ phone: cleanPhone });
        if (!existingUser) {
          const newUserData = {
            fullName: customerName?.trim() || 'Khách vãng lai',
            phone: cleanPhone,
            password: 'guest_no_login_needed',
            role: 'CUSTOMER',
            status: 'ACTIVE'
          };
          if (cleanEmail) {
            newUserData.email = cleanEmail;
          }

          existingUser = await User.create(newUserData);
        } else {
          if (existingUser.status !== 'ACTIVE') {
            const err = new Error(
              existingUser.lockReason || 'Tài khoản liên kết với số điện thoại này đã bị khóa. Vui lòng liên hệ Admin.'
            );
            err.statusCode = 403;
            throw err;
          }
          let needSave = false;
          if (customerName && customerName.trim() && existingUser.fullName === 'Khách vãng lai') {
            existingUser.fullName = customerName.trim();
            needSave = true;
          }
          if (cleanEmail && !existingUser.email) {
            existingUser.email = cleanEmail;
            needSave = true;
          }
          if (needSave) {
            await existingUser.save();
          }
        }
        customerId = existingUser._id;
      } else {
        customerId = currentUser?.userId || currentUser?._id;
      }
    }

    if (!customerId) {
      const err = new Error('Vui lòng chọn hoặc cung cấp thông tin khách hàng đặt sân (Họ tên, Số điện thoại)!');
      err.statusCode = 400;
      throw err;
    }

    // Xác định danh sách các sân và khung giờ cần đặt (hỗ trợ cả mảng courtOrders lẫn courtIds / courtId)
    let targetOrders = [];
    if (Array.isArray(courtOrders) && courtOrders.length > 0) {
      targetOrders = courtOrders.map((order) => order || {});
    } else {
      const targetCourtIds = Array.isArray(courtIds) && courtIds.length > 0
        ? courtIds
        : (courtId ? [courtId] : []);
      if (startTime && endTime) {
        targetOrders = targetCourtIds.map((cId) => ({
          courtId: cId,
          startTime,
          endTime
        }));
      }
    }

    if (targetOrders.length === 0 || !bookingDate) {
      const err = new Error('Vui lòng chọn ít nhất một sân thi đấu, Ngày đặt và Khung giờ!');
      err.statusCode = 400;
      throw err;
    }

    for (const ord of targetOrders) {
      if (
        !ord.courtId ||
        !mongoose.Types.ObjectId.isValid(ord.courtId) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ord.startTime || '') ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ord.endTime || '') ||
        parseTimeToMinutes(ord.startTime) >= parseTimeToMinutes(ord.endTime)
      ) {
        const err = new Error('Một hoặc nhiều sân hoặc khung giờ không hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
    }

    const uniqueCourtIds = [...new Set(targetOrders.map((o) => o.courtId.toString()))];
    if ((currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF') &&
      bodyStatus && !['CONFIRMED', 'PENDING_APPROVAL'].includes(bodyStatus)) {
      const err = new Error('Trạng thái tạo đơn không hợp lệ.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Kiểm tra ngày đặt không được trong quá khứ
    const bookingDateObj = new Date(bookingDate);
    if (!bookingDate || Number.isNaN(bookingDateObj.getTime())) {
      const err = new Error('Ngày đặt sân không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(bookingDateObj);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate < today) {
      const err = new Error('Không thể đặt sân cho ngày trong quá khứ!');
      err.statusCode = 400;
      throw err;
    }

    const finalStatus = currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF'
      ? (bodyStatus === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : 'CONFIRMED')
      : 'PENDING_APPROVAL';
    const created = await this.withCourtLocks(uniqueCourtIds, async (session, lease) => {
      await this.assertOrdersAvailable(targetOrders, bookingDateObj, null, session);
      const priceCalculation = await this.calculateBookingPrice({
        courtOrders: targetOrders,
        bookingDate,
        voucherCode
      });
      if (priceCalculation.courtBreakdowns.length !== targetOrders.length) {
        const err = new Error('Không thể tính giá cho đầy đủ sân và khung giờ trong đơn.');
        err.statusCode = 400;
        throw err;
      }

      const { courtBreakdowns, totalBasePrice, discount } = priceCalculation;
      const appliedVoucherId = priceCalculation.appliedVoucher?.voucherId || null;
      if (lease) await lease.ensure();
      if (appliedVoucherId) {
        await Voucher.updateOne(
          { _id: appliedVoucherId },
          { $inc: { usedCount: 1 } },
          session ? { session } : {}
        );
      }

      const dateStr = bookingDateObj.toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const bookingCode = `BK${dateStr}${randomSuffix}`;
      const bookingItems = courtBreakdowns.map((cb) => ({
        courtId: cb.courtId,
        courtName: cb.courtName,
        courtType: cb.courtType,
        location: cb.location || '',
        bookingDate: new Date(cb.bookingDate || bookingDateObj),
        startTime: cb.startTime,
        endTime: cb.endTime,
        durationMinutes: cb.durationMinutes,
        durationHours: cb.durationHours,
        price: cb.totalAmount,
        intervals: cb.intervals || []
      }));
      const overallStartTime = targetOrders.map((order) => order.startTime).sort()[0];
      const overallEndTime = targetOrders.map((order) => order.endTime).sort().slice(-1)[0];
      const intervalSummary = courtBreakdowns.map((cb) => {
        const intervals = cb.intervals
          .map((it) => `${it.startTime}-${it.endTime} (${it.priceType}: ${it.amount.toLocaleString('vi-VN')}đ)`)
          .join(', ');
        return `${cb.courtName} [${cb.startTime}-${cb.endTime}: ${intervals}]`;
      }).join('; ');
      const combinedNote = note ? `${note} | [Chi tiết: ${intervalSummary}]` : `[Chi tiết: ${intervalSummary}]`;
      const [newBooking] = await Booking.create([{
        bookingCode,
        customerId,
        courtId: targetOrders[0].courtId,
        voucherId: appliedVoucherId,
        bookingDate: bookingDateObj,
        startTime: overallStartTime,
        endTime: overallEndTime,
        price: totalBasePrice,
        discount,
        totalAmount: Math.max(0, totalBasePrice - discount),
        paymentMethod: paymentMethod || 'CASH',
        paymentStatus: 'UNPAID',
        status: finalStatus,
        items: bookingItems,
        note: combinedNote
      }], session ? { session } : {});
      return { booking: newBooking, priceCalculation, bookingCode };
    });

    // 6. Tạo thông báo cho hệ thống
    try {
      const summaryList = created.priceCalculation.courtBreakdowns
        .map((cb) => `${cb.courtName} (${cb.startTime}-${cb.endTime})`).join(', ');
      await Notification.create({
        recipientId: customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_SUCCESS',
        title: 'Đặt sân thành công!',
        message: finalStatus === 'CONFIRMED'
          ? `Đơn đặt sân #${created.bookingCode} tại ${summaryList} ngày ${bookingDate} đã được xác nhận.`
          : `Yêu cầu đặt sân #${created.bookingCode} tại ${summaryList} ngày ${bookingDate} đang chờ nhân viên duyệt.`,
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Không thể tạo thông báo:', notifErr.message);
    }

    const populatedBooking = await Booking.findById(created.booking._id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('items.courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();

    return {
      ...populatedBooking,
      courtBreakdowns: created.priceCalculation.courtBreakdowns,
      intervals: created.priceCalculation.courtBreakdowns[0]?.intervals || []
    };
  }

  /**
   * 8. Cập nhật trạng thái đơn đặt sân
   */
  async loadPopulatedBooking(id) {
    return Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('items.courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();
  }

  getBookingCancellationTarget(booking, itemIds) {
    const activeOrders = getActiveBookingOrders(booking);
    if (activeOrders.length === 0) {
      const err = new Error('Tất cả lịch sân trong đơn này đã được hủy.');
      err.statusCode = 409;
      throw err;
    }
    if (itemIds == null) {
      return { orders: activeOrders, cancelsWholeBooking: true };
    }
    const requestedItemIds = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (
      requestedItemIds.length === 0 ||
      requestedItemIds.some((itemId) => !mongoose.Types.ObjectId.isValid(itemId))
    ) {
      const err = new Error('Mã chi tiết lịch sân không hợp lệ.');
      err.statusCode = 400;
      throw err;
    }
    const normalizedItemIds = requestedItemIds.map(String);
    if (new Set(normalizedItemIds).size !== normalizedItemIds.length) {
      const err = new Error('Danh sách chi tiết lịch sân có mã bị lặp.');
      err.statusCode = 400;
      throw err;
    }
    const allOrders = getBookingOrders(booking);
    const selectedOrders = normalizedItemIds.map((itemId) => {
      const selectedOrder = activeOrders.find((order) => order.itemId === itemId);
      if (selectedOrder) return selectedOrder;
      const exists = allOrders.some((order) => order.itemId === itemId);
      const err = new Error(exists
        ? 'Lịch sân này đã được hủy trước đó.'
        : 'Không tìm thấy chi tiết lịch sân cần hủy.');
      err.statusCode = exists ? 409 : 404;
      throw err;
    });
    return {
      orders: selectedOrders,
      cancelsWholeBooking: activeOrders.length === selectedOrders.length
    };
  }

  assertBookingItemsCanBeCancelled(booking, orders) {
    if (!isPendingBooking(booking.status) && booking.status !== 'CONFIRMED') {
      const err = new Error('Chỉ đơn đang chờ duyệt hoặc đã xác nhận mới được hủy.');
      err.statusCode = 409;
      throw err;
    }

    const now = new Date();
    for (const order of orders) {
      const startsAt = getBookingStartDate(order.bookingDate || booking.bookingDate, order.startTime);
      if (!startsAt) {
        const err = new Error('Không thể xác định ngày hoặc giờ bắt đầu của lịch đặt sân.');
        err.statusCode = 409;
        throw err;
      }
      if (startsAt <= now) {
        const err = new Error(
          `Không thể hủy vì lịch sân ${order.courtName || ''} đã đến hoặc vượt quá giờ bắt đầu (${order.startTime}).`.trim()
        );
        err.statusCode = 409;
        throw err;
      }
    }
  }

  async cancelBookingAsCustomer(id, currentUser, itemId = null) {
    const customerId = currentUser.userId || currentUser._id;
    const session = await Booking.startSession();
    let committedBooking;
    let cancellationCount = 0;
    let accountLocked = false;
    let cancelledItemIds = [];
    const cancellationScope = itemId ? 'ITEM' : 'BOOKING';

    try {
      await session.withTransaction(async () => {
        const account = await User.findOne({
          _id: customerId,
          role: 'CUSTOMER',
          status: 'ACTIVE'
        }).session(session);
        if (!account) {
          const err = new Error('Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.');
          err.statusCode = 403;
          throw err;
        }

        const booking = await Booking.findById(id).session(session);
        if (!booking) {
          const err = new Error('Không tìm thấy đơn đặt sân!');
          err.statusCode = 404;
          throw err;
        }
        if (booking.customerId.toString() !== customerId.toString()) {
          const err = new Error('Bạn không có quyền hủy đơn đặt sân này.');
          err.statusCode = 403;
          throw err;
        }
        const cancellationTarget = this.getBookingCancellationTarget(booking, itemId);
        this.assertBookingItemsCanBeCancelled(booking, cancellationTarget.orders);
        cancelledItemIds = cancellationTarget.orders.map((order) => order.itemId).filter(Boolean);

        const cancelledAt = new Date();
        const previousStatus = booking.status;
        const countsTowardMonthlyLimit = previousStatus === 'CONFIRMED' &&
          cancellationTarget.cancelsWholeBooking;
        const previousCount = countMonthlyConfirmedCancellations(
          account.bookingCancellationHistory,
          cancelledAt
        );
        if (countsTowardMonthlyLimit && previousCount >= CUSTOMER_CANCELLATION_LIMIT) {
          const err = new Error(CUSTOMER_CANCELLATION_LOCK_REASON);
          err.statusCode = 403;
          throw err;
        }
        cancellationCount = countsTowardMonthlyLimit ? previousCount + 1 : previousCount;
        accountLocked = countsTowardMonthlyLimit &&
          cancellationCount === CUSTOMER_CANCELLATION_LIMIT;

        const audit = {
          bookingId: booking._id,
          bookingCode: booking.bookingCode,
          cancelledAt,
          previousStatus,
          itemId: itemId || null,
          scope: itemId ? 'ITEM' : 'BOOKING',
          countsTowardMonthlyLimit
        };
        const targetItemIds = new Set(
          cancellationTarget.orders.map((order) => order.itemId).filter(Boolean)
        );
        if (Array.isArray(booking.items) && booking.items.length > 0) {
          booking.items.forEach((item) => {
            if (targetItemIds.has(item._id.toString())) item.status = 'CANCELLED';
          });
          booking.status = booking.items.every((item) => item.status === 'CANCELLED')
            ? 'CANCELLED'
            : previousStatus;
        } else {
          booking.status = 'CANCELLED';
        }
        Object.assign(booking, getBookingTotalsForActiveItems(booking));
        booking.cancellationHistory.push({
          cancelledAt,
          cancelledBy: customerId,
          cancelledByRole: 'CUSTOMER',
          previousStatus,
          itemId: itemId || null,
          scope: cancellationScope,
          countsTowardMonthlyLimit
        });
        if (booking.status === 'CANCELLED' && booking.voucherId) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session }
          );
        }
        await booking.save({ session });

        account.bookingCancellationHistory.push(audit);
        account.bookingCancellationVersion += 1;
        if (accountLocked) {
          account.status = 'LOCKED';
          account.lockReason = CUSTOMER_CANCELLATION_LOCK_REASON;
          account.lockedAt = cancelledAt;
          account.lockedByBookingId = booking._id;
          account.accountLockHistory.push({
            action: 'LOCKED',
            reason: CUSTOMER_CANCELLATION_LOCK_REASON,
            occurredAt: cancelledAt,
            performedBy: customerId,
            bookingId: booking._id
          });
        }
        await account.save({ session });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.cancelBookingAsCustomerWithoutTransaction(id, customerId, itemId);
      }
      throw error;
    } finally {
      await session.endSession();
    }

    try {
      await Notification.create({
        recipientId: committedBooking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_CANCELLED',
        title: committedBooking.status === 'CANCELLED'
          ? 'Đơn đặt sân đã bị hủy'
          : 'Lịch sân trong đơn đã bị hủy',
        message: committedBooking.status === 'CANCELLED'
          ? `Đơn đặt sân #${committedBooking.bookingCode} đã được bạn hủy.`
          : `Bạn đã hủy một lịch sân trong đơn #${committedBooking.bookingCode}.`,
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
    }

    const result = await this.loadPopulatedBooking(id);
    return {
      ...result,
      cancellationResult: {
        cancellationCount,
        accountLocked,
        lockReason: accountLocked ? CUSTOMER_CANCELLATION_LOCK_REASON : '',
        scope: cancellationScope,
        cancelledItemIds
      }
    };
  }

  async cancelBookingAsCustomerWithoutTransaction(id, customerId, itemId = null) {
    const token = require('crypto').randomUUID();
    let acquired = false;
    let savedBooking;
    let cancellationCount = 0;
    let accountLocked = false;
    let cancellationScope = itemId ? 'ITEM' : 'BOOKING';
    let cancelledItemIds = [];
    const acquireUntil = Date.now() + 5000;

    try {
      while (!acquired && Date.now() < acquireUntil) {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + 30000);
        const account = await User.findOneAndUpdate(
          {
            _id: customerId,
            role: 'CUSTOMER',
            status: 'ACTIVE',
            $or: [
              { cancellationLockUntil: { $exists: false } },
              { cancellationLockUntil: null },
              { cancellationLockUntil: { $lte: now } }
            ]
          },
          {
            $set: {
              cancellationLockToken: token,
              cancellationLockUntil: leaseUntil
            }
          },
          { returnDocument: 'after' }
        );
        if (account) {
          acquired = true;
          break;
        }
        const currentAccount = await User.findById(customerId).select('status lockReason').lean();
        if (!currentAccount || currentAccount.status !== 'ACTIVE') {
          const err = new Error(
            currentAccount?.lockReason ||
            'Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.'
          );
          err.statusCode = 403;
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!acquired) {
        const err = new Error('Yêu cầu hủy khác đang được xử lý. Vui lòng thử lại.');
        err.statusCode = 409;
        throw err;
      }

      const account = await User.findOne({
        _id: customerId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        cancellationLockToken: token
      });
      const booking = await Booking.findById(id);
      if (!account) {
        const err = new Error('Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.');
        err.statusCode = 403;
        throw err;
      }
      if (!booking) {
        const err = new Error('Không tìm thấy đơn đặt sân!');
        err.statusCode = 404;
        throw err;
      }
      if (booking.customerId.toString() !== customerId.toString()) {
        const err = new Error('Bạn không có quyền hủy đơn đặt sân này.');
        err.statusCode = 403;
        throw err;
      }
      const cancellationTarget = this.getBookingCancellationTarget(booking, itemId);
      this.assertBookingItemsCanBeCancelled(booking, cancellationTarget.orders);
      cancelledItemIds = cancellationTarget.orders.map((order) => order.itemId).filter(Boolean);

      const cancelledAt = new Date();
      const previousStatus = booking.status;
      const countsTowardMonthlyLimit = previousStatus === 'CONFIRMED' &&
        cancellationTarget.cancelsWholeBooking;
      const previousCount = countMonthlyConfirmedCancellations(
        account.bookingCancellationHistory,
        cancelledAt
      );
      if (countsTowardMonthlyLimit && previousCount >= CUSTOMER_CANCELLATION_LIMIT) {
        const err = new Error(CUSTOMER_CANCELLATION_LOCK_REASON);
        err.statusCode = 403;
        throw err;
      }
      cancellationCount = countsTowardMonthlyLimit ? previousCount + 1 : previousCount;
      accountLocked = countsTowardMonthlyLimit &&
        cancellationCount === CUSTOMER_CANCELLATION_LIMIT;

      const audit = {
        bookingId: booking._id,
        bookingCode: booking.bookingCode,
        cancelledAt,
        previousStatus,
        itemId: itemId || null,
        scope: cancellationScope,
        countsTowardMonthlyLimit
      };
      const nextStatus = cancellationTarget.cancelsWholeBooking ? 'CANCELLED' : previousStatus;
      const totals = getBookingTotalsForActiveItems(booking, cancelledItemIds);
      const updateFields = { status: nextStatus, ...totals };
      const updateOptions = { returnDocument: 'after', runValidators: true };
      if (cancelledItemIds.length > 0) {
        updateFields['items.$[cancelTarget].status'] = 'CANCELLED';
        updateOptions.arrayFilters = [{ 'cancelTarget._id': { $in: cancelledItemIds } }];
      }
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, __v: booking.__v, status: previousStatus },
        {
          $set: updateFields,
          $push: {
            cancellationHistory: {
              cancelledAt,
              cancelledBy: customerId,
              cancelledByRole: 'CUSTOMER',
              previousStatus,
              itemId: itemId || null,
              scope: cancellationScope,
              countsTowardMonthlyLimit
            }
          },
          $inc: { __v: 1 }
        },
        updateOptions
      );
      if (!updated) {
        const err = new Error('Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.');
        err.statusCode = 409;
        throw err;
      }
      savedBooking = updated;

      const accountUpdate = {
        $push: { bookingCancellationHistory: audit },
        $inc: { bookingCancellationVersion: 1 }
      };
      if (accountLocked) {
        accountUpdate.$set = {
          status: 'LOCKED',
          lockReason: CUSTOMER_CANCELLATION_LOCK_REASON,
          lockedAt: cancelledAt,
          lockedByBookingId: booking._id
        };
        accountUpdate.$push.accountLockHistory = {
          action: 'LOCKED',
          reason: CUSTOMER_CANCELLATION_LOCK_REASON,
          occurredAt: cancelledAt,
          performedBy: customerId,
          bookingId: booking._id
        };
      }
      const accountResult = await User.updateOne(
        {
          _id: customerId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          cancellationLockToken: token
        },
        accountUpdate
      );
      if (accountResult.modifiedCount !== 1) {
        const rollbackFields = {
          status: previousStatus,
          price: booking.price,
          discount: booking.discount,
          totalAmount: booking.totalAmount
        };
        const rollbackOptions = {};
        if (cancelledItemIds.length > 0) {
          rollbackFields['items.$[cancelTarget].status'] = 'ACTIVE';
          rollbackOptions.arrayFilters = [{ 'cancelTarget._id': { $in: cancelledItemIds } }];
        }
        await Booking.findOneAndUpdate(
          { _id: savedBooking._id, __v: savedBooking.__v, status: nextStatus },
          {
            $set: rollbackFields,
            $pull: {
              cancellationHistory: {
                cancelledAt,
                cancelledBy: customerId
              }
            },
            $inc: { __v: 1 }
          },
          rollbackOptions
        );
        savedBooking = null;
        const err = new Error('Không thể hoàn tất việc ghi nhận hủy đơn. Đơn đặt sân vẫn được giữ nguyên.');
        err.statusCode = 409;
        throw err;
      }

      if (nextStatus === 'CANCELLED' && booking.voucherId) {
        await Voucher.updateOne({ _id: booking.voucherId }, { $inc: { usedCount: -1 } });
      }
    } finally {
      if (acquired) {
        await User.updateOne(
          { _id: customerId, cancellationLockToken: token },
          { $unset: { cancellationLockToken: 1, cancellationLockUntil: 1 } }
        );
      }
    }

    try {
      await Notification.create({
        recipientId: savedBooking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_CANCELLED',
        title: savedBooking.status === 'CANCELLED'
          ? 'Đơn đặt sân đã bị hủy'
          : 'Lịch sân trong đơn đã bị hủy',
        message: savedBooking.status === 'CANCELLED'
          ? `Đơn đặt sân #${savedBooking.bookingCode} đã được bạn hủy.`
          : `Bạn đã hủy một lịch sân trong đơn #${savedBooking.bookingCode}.`,
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
    }

    const result = await this.loadPopulatedBooking(id);
    return {
      ...result,
      cancellationResult: {
        cancellationCount,
        accountLocked,
        lockReason: accountLocked ? CUSTOMER_CANCELLATION_LOCK_REASON : '',
        scope: cancellationScope,
        cancelledItemIds
      }
    };
  }

  async cancelBookingItemsAsStaff(id, currentUser, itemIds) {
    const actorId = currentUser.userId || currentUser._id;
    const isWholeBookingRequest = itemIds == null;
    const session = await Booking.startSession();
    let committedBooking;
    let cancellationTarget;
    const cancelledAt = new Date();

    try {
      await session.withTransaction(async () => {
        const booking = await Booking.findById(id).session(session);
        if (!booking) {
          const err = new Error('Không tìm thấy đơn đặt sân!');
          err.statusCode = 404;
          throw err;
        }
        cancellationTarget = this.getBookingCancellationTarget(booking, itemIds);
        this.assertBookingItemsCanBeCancelled(booking, cancellationTarget.orders);

        const previousStatus = booking.status;
        const cancelledItemIds = cancellationTarget.orders.map((order) => order.itemId).filter(Boolean);
        const targetItemIds = new Set(cancelledItemIds);
        booking.items.forEach((item) => {
          if (targetItemIds.has(item._id.toString())) item.status = 'CANCELLED';
        });
        booking.status = cancellationTarget.cancelsWholeBooking ? 'CANCELLED' : previousStatus;
        Object.assign(booking, getBookingTotalsForActiveItems(booking));

        cancellationTarget.orders.forEach((order) => {
          booking.cancellationHistory.push({
            cancelledAt,
            cancelledBy: actorId,
            cancelledByRole: currentUser.role,
            previousStatus,
            itemId: order.itemId,
            scope: 'ITEM',
            countsTowardMonthlyLimit: false
          });
        });

        if (
          booking.status === 'CANCELLED' &&
          !['CANCELLED', 'REJECTED'].includes(previousStatus) &&
          booking.voucherId
        ) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session }
          );
        }
        await booking.save({ session });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.cancelBookingItemsAsStaffWithoutTransaction(id, currentUser, itemIds);
      }
      throw error;
    } finally {
      await session.endSession();
    }

    await this.notifyStaffBookingItemsCancelled(
      committedBooking,
      cancellationTarget.orders,
      isWholeBookingRequest
    );
    return {
      ...(await this.loadPopulatedBooking(id)),
      cancellationResult: {
        scope: isWholeBookingRequest ? 'BOOKING' : 'ITEMS',
        cancelledItemIds: cancellationTarget.orders.map((order) => order.itemId).filter(Boolean)
      }
    };
  }

  async cancelBookingItemsAsStaffWithoutTransaction(id, currentUser, itemIds) {
    const actorId = currentUser.userId || currentUser._id;
    const isWholeBookingRequest = itemIds == null;
    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error('Không tìm thấy đơn đặt sân!');
      err.statusCode = 404;
      throw err;
    }
    const cancellationTarget = this.getBookingCancellationTarget(booking, itemIds);
    this.assertBookingItemsCanBeCancelled(booking, cancellationTarget.orders);

    const cancelledAt = new Date();
    const cancelledItemIds = cancellationTarget.orders.map((order) => order.itemId).filter(Boolean);
    const previousStatus = booking.status;
    const nextStatus = cancellationTarget.cancelsWholeBooking ? 'CANCELLED' : previousStatus;
    const totals = getBookingTotalsForActiveItems(booking, cancelledItemIds);
    const cancellationHistory = cancellationTarget.orders.map((order) => ({
      cancelledAt,
      cancelledBy: actorId,
      cancelledByRole: currentUser.role,
      previousStatus,
      itemId: order.itemId,
      scope: 'ITEM',
      countsTowardMonthlyLimit: false
    }));
    const updateFields = { status: nextStatus, ...totals };
    const updateOptions = {
      arrayFilters: [{ 'cancelTarget._id': { $in: cancelledItemIds } }],
      returnDocument: 'after',
      runValidators: true
    };
    updateFields['items.$[cancelTarget].status'] = 'CANCELLED';
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, __v: booking.__v, status: previousStatus },
      {
        $set: updateFields,
        $push: { cancellationHistory: { $each: cancellationHistory } },
        $inc: { __v: 1 }
      },
      updateOptions
    );
    if (!updatedBooking) {
      const err = new Error('Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.');
      err.statusCode = 409;
      throw err;
    }

    if (
      nextStatus === 'CANCELLED' &&
      !['CANCELLED', 'REJECTED'].includes(previousStatus) &&
      booking.voucherId
    ) {
      try {
        await Voucher.updateOne({ _id: booking.voucherId }, { $inc: { usedCount: -1 } });
      } catch (error) {
        const rollbackFields = {
          status: previousStatus,
          price: booking.price,
          discount: booking.discount,
          totalAmount: booking.totalAmount,
          'items.$[cancelTarget].status': 'ACTIVE'
        };
        const rollback = await Booking.findOneAndUpdate(
          { _id: updatedBooking._id, __v: updatedBooking.__v, status: nextStatus },
          {
            $set: rollbackFields,
            $pull: {
              cancellationHistory: {
                cancelledAt,
                cancelledBy: actorId
              }
            },
            $inc: { __v: 1 }
          },
          { arrayFilters: updateOptions.arrayFilters }
        );
        if (!rollback) {
          const rollbackError = new Error(
            'Không thể cập nhật voucher hoặc khôi phục trạng thái booking; cần kiểm tra dữ liệu booking.'
          );
          rollbackError.statusCode = 500;
          throw rollbackError;
        }
        throw error;
      }
    }

    await this.notifyStaffBookingItemsCancelled(
      updatedBooking,
      cancellationTarget.orders,
      isWholeBookingRequest
    );
    return {
      ...(await this.loadPopulatedBooking(id)),
      cancellationResult: {
        scope: isWholeBookingRequest ? 'BOOKING' : 'ITEMS',
        cancelledItemIds
      }
    };
  }

  async notifyStaffBookingItemsCancelled(booking, orders, isWholeBookingRequest) {
    const details = orders.map((order) =>
      `${order.courtName || 'Sân'} ${order.startTime}-${order.endTime}`
    ).join(', ');
    const isWholeBookingCancelled = isWholeBookingRequest || booking.status === 'CANCELLED';
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_CANCELLED',
        title: isWholeBookingCancelled ? 'Đơn đặt sân đã bị hủy' : 'Lịch sân trong đơn đã bị hủy',
        message: isWholeBookingRequest
          ? `Nhân viên đã hủy đơn đặt sân #${booking.bookingCode}.`
          : `Nhân viên đã hủy ${details} trong đơn đặt sân #${booking.bookingCode}.`,
        isRead: false
      });
    } catch (notifErr) {
      console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
    }
  }

  async updateBookingStatusWithoutTransaction(id, updateData, currentUser, isCustomer, isStaff) {
    const { status, paymentStatus, note } = updateData;
    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error('Không tìm thấy đơn đặt sân!');
      err.statusCode = 404;
      throw err;
    }
    if (isCustomer && booking.customerId.toString() !== (currentUser.userId || currentUser._id).toString()) {
      const err = new Error('Bạn không có quyền cập nhật đơn đặt sân này.');
      err.statusCode = 403;
      throw err;
    }
    if (isCustomer && !(isPendingBooking(booking.status) && status === 'CANCELLED')) {
      const err = new Error('Khách hàng chỉ được hủy đơn đang chờ duyệt.');
      err.statusCode = 409;
      throw err;
    }
    if (status && status === booking.status && ['CANCELLED', 'REJECTED'].includes(status)) {
      const err = new Error(`Đơn đã ở trạng thái ${status} và không thể xử lý lặp lại.`);
      err.statusCode = 409;
      throw err;
    }

    const transitions = {
      PENDING: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
      PENDING_APPROVAL: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
      CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
      CHECKED_IN: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
      REJECTED: []
    };
    if (status && status !== booking.status && !(transitions[booking.status] || []).includes(status)) {
      const err = new Error(`Không thể chuyển đơn từ ${booking.status} sang ${status}.`);
      err.statusCode = 409;
      throw err;
    }
    if (status === 'CONFIRMED') {
      const err = new Error('Không thể xác nhận an toàn khi MongoDB không hỗ trợ transaction.');
      err.statusCode = 503;
      throw err;
    }

    const updateFields = {};
    if (status) updateFields.status = status;
    if (paymentStatus) {
      if (paymentStatus === 'PAID') {
        if (booking.paymentStatus === 'PAID') {
          const err = new Error('Đơn đặt sân này đã được ghi nhận thanh toán trước đó.');
          err.statusCode = 409;
          throw err;
        }
        const effectiveStatus = status || booking.status;
        if (!['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(effectiveStatus)) {
          const err = new Error(
            `Không thể ghi nhận thanh toán cho đơn đang ở trạng thái ${booking.status}. Chỉ ghi nhận thanh toán khi đơn đã xác nhận, đang nhận sân hoặc đã hoàn thành.`
          );
          err.statusCode = 409;
          throw err;
        }
      }
      if (['CANCELLED', 'REJECTED'].includes(booking.status) && !status) {
        const err = new Error(
          `Không thể cập nhật thanh toán cho đơn đã bị ${booking.status === 'CANCELLED' ? 'hủy' : 'từ chối'}.`
        );
        err.statusCode = 409;
        throw err;
      }
      updateFields.paymentStatus = paymentStatus;
    }
    if (typeof note === 'string' && isStaff) {
      updateFields.note = status === 'REJECTED'
        ? (booking.note ? `${booking.note} | ${note}` : note)
        : note;
    }
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, __v: booking.__v, status: booking.status },
      { $set: updateFields, $inc: { __v: 1 } },
      { returnDocument: 'after', runValidators: true }
    );
    if (!updatedBooking) {
      const err = new Error('Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.');
      err.statusCode = 409;
      throw err;
    }
    if (
      (status === 'CANCELLED' || status === 'REJECTED') &&
      !['CANCELLED', 'REJECTED'].includes(booking.status) &&
      booking.voucherId
    ) {
      await Voucher.updateOne({ _id: booking.voucherId }, { $inc: { usedCount: -1 } });
    }

    if (status === 'CANCELLED' || status === 'REJECTED') {
      try {
        await Notification.create({
          recipientId: updatedBooking.customerId,
          recipientType: 'CUSTOMER',
          type: status === 'REJECTED' ? 'BOOKING_REJECTED' : 'BOOKING_CANCELLED',
          title: status === 'REJECTED' ? 'Yêu cầu đặt sân đã bị từ chối' : 'Đơn đặt sân đã bị hủy',
          message: status === 'REJECTED'
            ? `Đơn đặt sân #${updatedBooking.bookingCode} đã bị từ chối.`
            : `Đơn đặt sân #${updatedBooking.bookingCode} đã bị hủy.`,
          isRead: false
        });
      } catch (notifErr) {
        console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
      }
    }
    return this.loadPopulatedBooking(id);
  }

  /**
   * 8. Cập nhật trạng thái đơn đặt sân
   */
  async updateBookingStatus(id, updateData, currentUser = null) {
    const { status, paymentStatus, note } = updateData;
    const isCustomer = currentUser?.role === 'CUSTOMER';
    const isStaff = currentUser?.role === 'STAFF' || currentUser?.role === 'ADMIN';
    if (!isCustomer && !isStaff) {
      const err = new Error('Bạn không có quyền cập nhật đơn đặt sân này.');
      err.statusCode = 403;
      throw err;
    }
    const hasItemId = Object.prototype.hasOwnProperty.call(updateData, 'itemId');
    const hasItemIds = Object.prototype.hasOwnProperty.call(updateData, 'itemIds');
    if (isCustomer && (paymentStatus || typeof note === 'string' || status !== 'CANCELLED' || hasItemIds)) {
      const err = new Error('Khách hàng chỉ có quyền hủy đơn đặt sân của chính mình.');
      err.statusCode = 403;
      throw err;
    }
    if (isCustomer && hasItemId && hasItemIds) {
      const err = new Error('Yêu cầu chỉ được chỉ định một chi tiết lịch sân.');
      err.statusCode = 400;
      throw err;
    }
    if (status === 'REJECTED' && !isStaff) {
      const err = new Error('Chỉ Nhân viên hoặc Quản trị viên mới được từ chối đơn đặt sân.');
      err.statusCode = 403;
      throw err;
    }

    const validStatuses = ['PENDING', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (status && !validStatuses.includes(status)) {
      const err = new Error('Trạng thái đặt sân không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }
    const validPaymentStatuses = ['UNPAID', 'PAID', 'REFUNDED'];
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      const err = new Error('Trạng thái thanh toán không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }
    if (isCustomer) {
      return this.cancelBookingAsCustomer(id, currentUser, updateData.itemId || null);
    }
    if (hasItemId || hasItemIds || status === 'CANCELLED') {
      const selectedItemIds = hasItemIds ? updateData.itemIds : updateData.itemId;
      if (
        status !== 'CANCELLED' ||
        paymentStatus ||
        typeof note === 'string' ||
        (hasItemId && hasItemIds) ||
        ((hasItemId || hasItemIds) && selectedItemIds == null)
      ) {
        const err = new Error('Yêu cầu hủy chi tiết chỉ được gửi trạng thái CANCELLED và danh sách chi tiết.');
        err.statusCode = 400;
        throw err;
      }
      return this.cancelBookingItemsAsStaff(
        id,
        currentUser,
        selectedItemIds == null ? null : selectedItemIds
      );
    }

    let committedBooking;
    if (status === 'CONFIRMED') {
      if (!isStaff) {
        const err = new Error('Chỉ Nhân viên hoặc Quản trị viên mới được xác nhận đơn đặt sân.');
        err.statusCode = 403;
        throw err;
      }
      const currentBooking = await Booking.findById(id);
      if (!currentBooking) {
        const err = new Error('Không tìm thấy đơn đặt sân!');
        err.statusCode = 404;
        throw err;
      }
      if (!isPendingBooking(currentBooking.status)) {
        const err = new Error(`Không thể xác nhận đơn ở trạng thái ${currentBooking.status}.`);
        err.statusCode = 409;
        throw err;
      }
      const orders = getActiveBookingOrders(currentBooking);
      await this.withCourtLocks(orders.map((order) => order.courtId), async (session, lease) => {
        const booking = await Booking.findById(id).session(session);
        if (!booking || !isPendingBooking(booking.status)) {
          const err = new Error('Đơn đã được xử lý bởi thao tác khác và không còn chờ duyệt.');
          err.statusCode = 409;
          throw err;
        }
        const latestOrders = getActiveBookingOrders(booking);
        await this.lockCourts(latestOrders.map((order) => order.courtId), session, lease);
        await this.assertOrdersAvailable(latestOrders, booking.bookingDate, booking._id, session);
        if (lease) await lease.ensure();
        const updateFields = { status: 'CONFIRMED' };
        if (paymentStatus) updateFields.paymentStatus = paymentStatus;
        if (typeof note === 'string') updateFields.note = note;
        committedBooking = await Booking.findOneAndUpdate(
          {
            _id: booking._id,
            __v: booking.__v,
            status: { $in: ['PENDING', 'PENDING_APPROVAL'] }
          },
          { $set: updateFields, $inc: { __v: 1 } },
          { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) }
        );
        if (!committedBooking) {
          const err = new Error('Đơn đã được chỉnh sửa hoặc xử lý bởi thao tác khác. Vui lòng tải lại dữ liệu.');
          err.statusCode = 409;
          throw err;
        }
      });
      try {
        await Notification.create({
          recipientId: committedBooking.customerId,
          recipientType: 'CUSTOMER',
          type: 'BOOKING_CONFIRMED',
          title: 'Đơn đặt sân đã được duyệt!',
          message: `Đơn đặt sân #${committedBooking.bookingCode} đã được nhân viên duyệt thành công.`,
          isRead: false
        });
      } catch (notifErr) {
        console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
      }
      return this.loadPopulatedBooking(id);
    }

    const result = await Booking.startSession();
    try {
      await result.withTransaction(async () => {
        let bookingQuery = Booking.findById(id).session(result);
        const booking = await bookingQuery;
        if (!booking) {
          const err = new Error('Không tìm thấy đơn đặt sân!');
          err.statusCode = 404;
          throw err;
        }
        if (status && status === booking.status && ['CANCELLED', 'REJECTED'].includes(status)) {
          const err = new Error(`Đơn đã ở trạng thái ${status} và không thể xử lý lặp lại.`);
          err.statusCode = 409;
          throw err;
        }
        if (status && status !== booking.status) {
          const transitions = {
            PENDING: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
            PENDING_APPROVAL: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
            CONFIRMED: ['CHECKED_IN', 'CANCELLED'],
            CHECKED_IN: ['COMPLETED', 'CANCELLED'],
            COMPLETED: [],
            CANCELLED: [],
            REJECTED: []
          };
          if (!(transitions[booking.status] || []).includes(status)) {
            const err = new Error(
              `Không thể chuyển đơn từ ${booking.status} sang ${status}; đơn đã xử lý không thể duyệt hoặc từ chối lại.`
            );
            err.statusCode = 409;
            throw err;
          }
        }

        const previousStatus = booking.status;
        if (status) booking.status = status;
        if (paymentStatus) {
          if (paymentStatus === 'PAID') {
            if (booking.paymentStatus === 'PAID') {
              const err = new Error('Đơn đặt sân này đã được ghi nhận thanh toán trước đó.');
              err.statusCode = 409;
              throw err;
            }
            const effectiveStatus = status || booking.status;
            if (!['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(effectiveStatus)) {
              const err = new Error(
                `Không thể ghi nhận thanh toán cho đơn đang ở trạng thái ${booking.status}. Chỉ ghi nhận thanh toán khi đơn đã xác nhận, đang nhận sân hoặc đã hoàn thành.`
              );
              err.statusCode = 409;
              throw err;
            }
          }
          if (['CANCELLED', 'REJECTED'].includes(booking.status) && !status) {
            const err = new Error(
              `Không thể cập nhật thanh toán cho đơn đã bị ${booking.status === 'CANCELLED' ? 'hủy' : 'từ chối'}.`
            );
            err.statusCode = 409;
            throw err;
          }
          booking.paymentStatus = paymentStatus;
        }
        if (typeof note === 'string' && isStaff) {
          booking.note = status === 'REJECTED'
            ? (booking.note ? `${booking.note} | ${note}` : note)
            : note;
        }
        if (
          (status === 'CANCELLED' || status === 'REJECTED') &&
          !['CANCELLED', 'REJECTED'].includes(previousStatus) &&
          booking.voucherId
        ) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session: result }
          );
        }
        await booking.save({ session: result });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.updateBookingStatusWithoutTransaction(id, updateData, currentUser, isCustomer, isStaff);
      }
      throw error;
    } finally {
      await result.endSession();
    }

    if (status === 'CONFIRMED' || status === 'CANCELLED' || status === 'REJECTED') {
      try {
        await Notification.create({
          recipientId: committedBooking.customerId,
          recipientType: 'CUSTOMER',
          type: status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : status === 'REJECTED' ? 'BOOKING_REJECTED' : 'BOOKING_CANCELLED',
          title: status === 'CONFIRMED' ? 'Đơn đặt sân đã được duyệt!' : status === 'REJECTED' ? 'Yêu cầu đặt sân đã bị từ chối' : 'Đơn đặt sân đã bị hủy',
          message: status === 'CONFIRMED'
            ? `Đơn đặt sân #${committedBooking.bookingCode} đã được nhân viên duyệt thành công.`
            : status === 'REJECTED'
              ? `Đơn đặt sân #${committedBooking.bookingCode} đã bị từ chối.`
              : `Đơn đặt sân #${committedBooking.bookingCode} đã bị hủy.`,
          isRead: false
        });
      } catch (notifErr) {
        console.warn('Không thể gửi thông báo cập nhật:', notifErr.message);
      }
    }
    return this.loadPopulatedBooking(id);
  }

  /**
   * Customer edits remain pending; staff edits preserve the current booking status.
   */
  async changeBookingInfo(id, changeData, currentUser = null) {
    const isCustomer = currentUser?.role === 'CUSTOMER';
    const isStaff = currentUser?.role === 'STAFF' || currentUser?.role === 'ADMIN';
    if (!isCustomer && !isStaff) {
      const err = new Error('Bạn không có quyền chỉnh sửa đơn đặt sân.');
      err.statusCode = 403;
      throw err;
    }

    const originalBooking = await Booking.findById(id);
    if (!originalBooking) {
      const err = new Error('Không tìm thấy yêu cầu đặt sân.');
      err.statusCode = 404;
      throw err;
    }
    if (isCustomer && originalBooking.customerId.toString() !== (currentUser.userId || currentUser._id).toString()) {
      const err = new Error('Bạn không có quyền chỉnh sửa đơn đặt sân này.');
      err.statusCode = 403;
      throw err;
    }
    if (!isPendingBooking(originalBooking.status)) {
      const err = new Error('Chỉ đơn đang chờ duyệt mới được chỉnh sửa.');
      err.statusCode = 409;
      throw err;
    }
    if (isStaff && changeData.status) {
      const err = new Error('Không thể đổi trạng thái trong khi chỉnh sửa thông tin. Hãy dùng thao tác cập nhật trạng thái riêng.');
      err.statusCode = 400;
      throw err;
    }
    if (isCustomer && (changeData.status || changeData.price !== undefined || changeData.discount !== undefined || changeData.totalAmount !== undefined)) {
      const err = new Error('Khách hàng không được tự thay đổi trạng thái hoặc giá của đơn.');
      err.statusCode = 400;
      throw err;
    }

    const previousOrders = getBookingOrders(originalBooking);
    const targetOrders = previousOrders.map((order) => ({ ...order }));
    const itemIndexesUpdated = new Set();
    if (Array.isArray(changeData.courtOrders)) {
      if (changeData.courtOrders.length === 0) {
        const err = new Error('Đơn đặt sân phải có ít nhất một chi tiết.');
        err.statusCode = 400;
        throw err;
      }
      if (isCustomer) {
        targetOrders.length = 0;
        for (const [changeIndex, change] of changeData.courtOrders.entries()) {
          const previousIndex = change?.itemId
            ? previousOrders.findIndex((order) => order.itemId === String(change.itemId))
            : (Number.isInteger(change?.itemIndex)
              ? change.itemIndex
              : (changeIndex < previousOrders.length ? changeIndex : -1));
          if (previousIndex >= 0) {
            if (itemIndexesUpdated.has(previousIndex)) {
              const err = new Error('Chi tiết đặt sân bị gửi lặp.');
              err.statusCode = 400;
              throw err;
            }
            itemIndexesUpdated.add(previousIndex);
            if (previousOrders[previousIndex].status === 'CANCELLED') {
              targetOrders.push({ ...previousOrders[previousIndex] });
              continue;
            }
            targetOrders.push({
              ...previousOrders[previousIndex],
              ...(change.courtId !== undefined ? { courtId: change.courtId } : {}),
              ...(change.bookingDate !== undefined ? { bookingDate: change.bookingDate } : {}),
              ...(change.startTime !== undefined ? { startTime: change.startTime } : {}),
              ...(change.endTime !== undefined ? { endTime: change.endTime } : {})
            });
          } else if (!change?.itemId && !Number.isInteger(change?.itemIndex)) {
            targetOrders.push({
              courtId: change.courtId,
              bookingDate: change.bookingDate || changeData.bookingDate,
              startTime: change.startTime,
              endTime: change.endTime
            });
          } else {
            const err = new Error('Không tìm thấy chi tiết đặt sân cần sửa.');
            err.statusCode = 400;
            throw err;
          }
        }
        previousOrders.forEach((order) => {
          if (order.status === 'CANCELLED' &&
            !targetOrders.some((target) => target.itemId === order.itemId)) {
            targetOrders.push({ ...order });
          }
        });
      } else {
        for (const change of changeData.courtOrders) {
          const itemIndex = change?.itemId
            ? targetOrders.findIndex((order) => order.itemId === String(change.itemId))
            : (Number.isInteger(change?.itemIndex) ? change.itemIndex : -1);
          if (itemIndex < 0 || itemIndex >= targetOrders.length || itemIndexesUpdated.has(itemIndex)) {
            const err = new Error('Không tìm thấy chi tiết đặt sân cần sửa hoặc chi tiết bị gửi lặp.');
            err.statusCode = 400;
            throw err;
          }
          if (previousOrders.length > 1 && !change.itemId) {
            const err = new Error('Mỗi chi tiết của đơn nhiều sân phải được xác định bằng ID.');
            err.statusCode = 400;
            throw err;
          }
          if (targetOrders[itemIndex].status === 'CANCELLED') continue;
          itemIndexesUpdated.add(itemIndex);
          targetOrders[itemIndex] = {
            ...targetOrders[itemIndex],
            ...(change.courtId !== undefined ? { courtId: change.courtId } : {}),
            ...(change.bookingDate !== undefined ? { bookingDate: change.bookingDate } : {}),
            ...(change.startTime !== undefined ? { startTime: change.startTime } : {}),
            ...(change.endTime !== undefined ? { endTime: change.endTime } : {})
          };
        }
      }
    } else if (changeData.courtId || changeData.startTime || changeData.endTime || changeData.bookingDate) {
      if (isStaff && previousOrders.length > 1) {
        const err = new Error('Vui lòng chọn chi tiết đặt sân cần sửa bằng ID.');
        err.statusCode = 400;
        throw err;
      }
      const firstActiveOrderIndex = targetOrders.findIndex((order) => order.status !== 'CANCELLED');
      if (firstActiveOrderIndex < 0) {
        const err = new Error('Đơn đặt sân phải còn ít nhất một lịch chưa bị hủy.');
        err.statusCode = 409;
        throw err;
      }
      targetOrders[firstActiveOrderIndex] = {
        ...targetOrders[firstActiveOrderIndex],
        ...(changeData.courtId ? { courtId: changeData.courtId } : {}),
        ...(changeData.bookingDate ? { bookingDate: changeData.bookingDate } : {}),
        ...(changeData.startTime ? { startTime: changeData.startTime } : {}),
        ...(changeData.endTime ? { endTime: changeData.endTime } : {})
      };
    }
    if (changeData.bookingDate) {
      const parsedDate = new Date(changeData.bookingDate);
      if (Number.isNaN(parsedDate.getTime())) {
        const err = new Error('Ngày đặt sân không hợp lệ.');
        err.statusCode = 400;
        throw err;
      }
      targetOrders.forEach((order) => {
        if (order.status !== 'CANCELLED') order.bookingDate = parsedDate;
      });
    }
    if (targetOrders.length === 0) {
      const err = new Error('Đơn đặt sân phải có ít nhất một chi tiết.');
      err.statusCode = 400;
      throw err;
    }

    const targetBookingDate = changeData.bookingDate
      ? new Date(changeData.bookingDate)
      : originalBooking.bookingDate;
    const activeTargetOrders = targetOrders.filter((order) => order.status !== 'CANCELLED');
    if (activeTargetOrders.length === 0) {
      const err = new Error('Đơn đặt sân phải còn ít nhất một lịch chưa bị hủy.');
      err.statusCode = 409;
      throw err;
    }
    const lockCourtIds = activeTargetOrders.map((order) => order.courtId);
    let savedBooking;
    let priceBreakdowns;
    const oldVoucherId = originalBooking.voucherId?.toString() || '';
    let voucherCode;
    let originalVoucher;
    if (originalBooking.voucherId) {
      originalVoucher = await Voucher.findById(originalBooking.voucherId)
        .select('voucherCode discountType discountValue maxDiscount minOrderAmount usageLimit usedCount startDate endDate status')
        .lean();
      voucherCode = originalVoucher?.voucherCode;
    }

    await this.withCourtLocks(lockCourtIds, async (session, lease) => {
      const booking = await Booking.findById(id).session(session);
      if (!booking || !isPendingBooking(booking.status)) {
        const err = new Error('Đơn đã được xử lý, không thể chỉnh sửa.');
        err.statusCode = 409;
        throw err;
      }
      if (booking.__v !== originalBooking.__v) {
        const err = new Error('Đơn đã được cập nhật bởi thao tác khác. Vui lòng tải lại dữ liệu trước khi sửa.');
        err.statusCode = 409;
        throw err;
      }
      if (isCustomer && booking.customerId.toString() !== (currentUser.userId || currentUser._id).toString()) {
        const err = new Error('Bạn không có quyền chỉnh sửa đơn đặt sân này.');
        err.statusCode = 403;
        throw err;
      }

      await this.lockCourts(targetOrders.map((order) => order.courtId), session, lease);
      await this.assertOrdersAvailable(activeTargetOrders, targetBookingDate, booking._id, session);
      const priceCalculation = await this.calculateBookingPrice({
        courtOrders: targetOrders,
        bookingDate: targetBookingDate,
        voucherCode,
        existingVoucherId: oldVoucherId
      });
      if (priceCalculation.courtBreakdowns.length !== targetOrders.length) {
        const err = new Error('Không thể tính giá cho đầy đủ sân và khung giờ trong đơn.');
        err.statusCode = 400;
        throw err;
      }

      const courtBreakdowns = priceCalculation.courtBreakdowns;
      const items = courtBreakdowns.map((item, index) => {
        const order = targetOrders[index];
        const previous = order.itemId
          ? previousOrders.find((oldOrder) => oldOrder.itemId === order.itemId)
          : (Number.isInteger(order.itemIndex) ? previousOrders[order.itemIndex] : null);
        const sameSchedule = previous &&
          String(order.courtId) === String(previous.courtId) &&
          new Date(order.bookingDate).toDateString() === new Date(previous.bookingDate).toDateString() &&
          order.startTime === previous.startTime &&
          order.endTime === previous.endTime;
        const existingIntervals = previous?.intervals || [];
        const calculatedIntervals = item.intervals || [];
        const samePriceConditions = previous &&
          existingIntervals.length === calculatedIntervals.length &&
          existingIntervals.every((interval, intervalIndex) => {
            const calculated = calculatedIntervals[intervalIndex];
            return interval.startTime === calculated.startTime &&
              interval.endTime === calculated.endTime &&
              interval.hourlyRate === calculated.hourlyRate &&
              interval.amount === calculated.amount;
          });
        const preserveExistingPrice = Boolean(previous) && (
          sameSchedule || (samePriceConditions && previous.price === item.totalAmount)
        );

        return {
          ...(order.itemId ? { _id: order.itemId } : {}),
          courtId: item.courtId,
          courtName: item.courtName,
          courtType: item.courtType,
          location: item.location || '',
          bookingDate: new Date(order.bookingDate),
          status: previous?.status || 'ACTIVE',
          startTime: item.startTime,
          endTime: item.endTime,
          durationMinutes: item.durationMinutes,
          durationHours: item.durationHours,
          price: preserveExistingPrice ? previous.price : item.totalAmount,
          intervals: preserveExistingPrice ? existingIntervals : calculatedIntervals
        };
      });
      const totalBasePrice = items.reduce((sum, item) => sum + (item.price || 0), 0);
      let discount = 0;
      const now = new Date();
      const voucherIsApplicable = originalVoucher &&
        originalVoucher.status === 'ACTIVE' &&
        (!originalVoucher.startDate || now >= new Date(originalVoucher.startDate)) &&
        (!originalVoucher.endDate || now <= new Date(originalVoucher.endDate)) &&
        (!originalVoucher.minOrderAmount || totalBasePrice >= originalVoucher.minOrderAmount) &&
        (originalVoucher.usageLimit <= 0 ||
          originalVoucher.usedCount < originalVoucher.usageLimit ||
          oldVoucherId === originalVoucher._id.toString());
      if (voucherIsApplicable && originalVoucher.discountType === 'PERCENTAGE') {
        discount = Math.round((totalBasePrice * originalVoucher.discountValue) / 100);
        if (originalVoucher.maxDiscount > 0) {
          discount = Math.min(discount, originalVoucher.maxDiscount);
        }
      } else if (voucherIsApplicable) {
        discount = Math.min(originalVoucher.discountValue || 0, totalBasePrice);
      } else if (!originalBooking.voucherId) {
        discount = Math.min(originalBooking.discount || 0, totalBasePrice);
      }
      discount = Math.min(discount, totalBasePrice);
      const finalTotalAmount = Math.max(0, totalBasePrice - discount);
      if (isStaff && finalTotalAmount !== originalBooking.totalAmount &&
        Number(changeData.confirmedTotalAmount) !== finalTotalAmount) {
        const err = new Error(
          `Tổng tiền sau khi chỉnh sửa là ${finalTotalAmount.toLocaleString('vi-VN')}đ. Vui lòng xác nhận mức giá mới trước khi lưu.`
        );
        err.statusCode = 409;
        throw err;
      }
      const starts = activeTargetOrders.map((order) => order.startTime).sort();
      const ends = activeTargetOrders.map((order) => order.endTime).sort();
      const bookingDates = activeTargetOrders.map((order) => new Date(order.bookingDate)).sort((a, b) => a - b);
      if (lease) await lease.ensure();
      const updateFields = {
        courtId: activeTargetOrders[0].courtId,
        items,
        bookingDate: bookingDates[0],
        startTime: starts[0],
        endTime: ends[ends.length - 1],
        price: totalBasePrice,
        discount,
        totalAmount: finalTotalAmount,
        voucherId: voucherIsApplicable ? originalBooking.voucherId : null
      };
      if (isCustomer) updateFields.status = 'PENDING_APPROVAL';
      if (typeof changeData.note === 'string') updateFields.note = changeData.note;
      if (isStaff && changeData.paymentMethod) {
        updateFields.paymentMethod = changeData.paymentMethod === 'VIETQR' ? 'CASH' : changeData.paymentMethod;
      }
      savedBooking = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          __v: booking.__v,
          status: { $in: ['PENDING', 'PENDING_APPROVAL'] }
        },
        { $set: updateFields, $inc: { __v: 1 } },
        { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) }
      );
      if (!savedBooking) {
        const err = new Error('Đơn đã được chỉnh sửa hoặc xử lý bởi thao tác khác. Vui lòng tải lại dữ liệu.');
        err.statusCode = 409;
        throw err;
      }
      const updatedVoucherId = updateFields.voucherId?.toString() || '';
      if (oldVoucherId && oldVoucherId !== updatedVoucherId) {
        await Voucher.updateOne(
          { _id: oldVoucherId },
          { $inc: { usedCount: -1 } },
          session ? { session } : {}
        );
      }
      priceBreakdowns = courtBreakdowns;
      priceBreakdowns.forEach((breakdown, index) => {
        breakdown.totalAmount = items[index].price;
      });
    });

    let notificationSent = true;
    if (isStaff) {
      try {
        const scheduleSummary = savedBooking.items.map((item) =>
          `${item.courtName} ngày ${new Date(item.bookingDate || savedBooking.bookingDate).toLocaleDateString('vi-VN')} (${item.startTime}-${item.endTime})`
        ).join('; ');
        await Notification.create({
          recipientId: savedBooking.customerId,
          recipientType: 'CUSTOMER',
          type: 'BOOKING_UPDATED',
          title: 'Thông tin đơn đặt sân đã thay đổi',
          message: `Đơn đặt sân #${savedBooking.bookingCode} đã được cập nhật: ${scheduleSummary}. Tổng tiền: ${savedBooking.totalAmount.toLocaleString('vi-VN')}đ. Trạng thái đơn vẫn là ${savedBooking.status}.`,
          isRead: false
        });
      } catch (notifErr) {
        notificationSent = false;
      }
    }

    return {
      booking: {
        ...(await this.loadPopulatedBooking(id)),
        courtBreakdowns: priceBreakdowns
      },
      notificationSent
    };
  }

  /**
   * 10. AF2: Từ chối yêu cầu đặt sân (Reject Booking)
   */
  async rejectBooking(id, reason = '', currentUser = null) {
    const booking = await this.updateBookingStatus(id, {
      status: 'REJECTED',
      note: reason ? `Lý do từ chối: ${reason.trim()}` : undefined
    }, currentUser);
    return { booking, notificationSent: true };
  }

  /**
   * 11. Lấy danh sách khách hàng phục vụ staff / admin đặt sân
   */
  async getCustomers(currentUser = null) {
    if (currentUser && currentUser.role !== 'ADMIN' && currentUser.role !== 'STAFF') {
      const err = new Error('Bạn không có quyền truy cập danh sách khách hàng.');
      err.statusCode = 403;
      throw err;
    }
    return User.find({ role: 'CUSTOMER' })
      .select('fullName phone email address')
      .sort({ fullName: 1 })
      .lean();
  }
}

module.exports = new BookingService();
