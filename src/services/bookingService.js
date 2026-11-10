const mongoose = require("mongoose");
const Booking = require("../models/booking");
const Court = require("../models/court");
const Customer = require("../models/customer");
const TimeSlot = require("../models/timeSlot");
const Price = require("../models/price");
const PriceRule = require("../models/priceRule");
const Voucher = require("../models/voucher");
const Notification = require("../models/notification");
const PlayingSession = require("../models/playingSession");
const Invoice = require("../models/invoice");
const { canBookCourt } = require("../utils/courtValidation");

// Hàm tiện ích chuyển đổi giờ HH:mm sang phút
const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":"))
    return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Hàm tiện ích chuyển đổi phút sang giờ HH:mm
const formatMinutesToTime = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// Chuẩn hóa loại sân về các phân khúc chuẩn
const normalizeCourtType = (type) => {
  if (!type) return "STANDARD";
  const t = String(type).trim().toUpperCase();
  if (t === "VIP" || t.includes("VIP") || t.includes("GỖ")) return "VIP";
  if (
    t === "PREMIUM" ||
    t.includes("PREMIUM") ||
    t.includes("THI ĐẤU") ||
    t.includes("PVC")
  )
    return "PREMIUM";
  return "STANDARD";
};

// Khớp loại sân giữa rule (PriceRule) và sân (Court)
const matchCourtType = (ruleCourtType, court) => {
  if (!ruleCourtType || ruleCourtType === "ALL") return true;
  const courtType = court?.courtType || "STANDARD";
  return normalizeCourtType(ruleCourtType) === normalizeCourtType(courtType);
};

// Khớp loại sân áp dụng cho Voucher (Phương án A - Scoped Line-Item)
const isCourtTypeApplicable = (applicableCourtTypes, courtType) => {
  if (
    !applicableCourtTypes ||
    !Array.isArray(applicableCourtTypes) ||
    applicableCourtTypes.length === 0
  ) {
    return true;
  }
  if (applicableCourtTypes.includes("ALL")) return true;
  const normalized = normalizeCourtType(courtType);
  return applicableCourtTypes.some(
    (type) => normalizeCourtType(type) === normalized,
  );
};

const isPendingBooking = (status) =>
  status === "PENDING" || status === "PENDING_APPROVAL";
const CUSTOMER_CANCELLATION_LIMIT = 3;
const CUSTOMER_CANCELLATION_LOCK_REASON =
  "Bạn đã đạt giới hạn 3 lần hủy đơn đặt sân đã xác nhận trong tháng. Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ mở khóa.";
const BUSINESS_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const isTransactionUnsupported = (error) =>
  error.code === 20 ||
  error.codeName === "IllegalOperation" ||
  /transaction numbers are only allowed|does not support transactions|does not support retryable writes/i.test(
    error.message,
  );

const getBusinessMonthRange = (date) => {
  const businessDate = new Date(date.getTime() + BUSINESS_TIME_ZONE_OFFSET_MS);
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - BUSINESS_TIME_ZONE_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - BUSINESS_TIME_ZONE_OFFSET_MS),
  };
};

const countMonthlyConfirmedCancellations = (history, at) => {
  const { start, end } = getBusinessMonthRange(at);
  return (history || []).filter(
    (entry) =>
      entry.countsTowardMonthlyLimit &&
      entry.cancelledAt >= start &&
      entry.cancelledAt < end,
  ).length;
};

const getBookingStartDate = (bookingDate, time) => {
  const date = new Date(bookingDate);
  if (
    Number.isNaN(date.getTime()) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || "")
  ) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(
    Date.UTC(part("year"), part("month") - 1, part("day"), hours, minutes) -
    BUSINESS_TIME_ZONE_OFFSET_MS,
  );
};

const getBookingOrders = (booking) => {
  if (Array.isArray(booking.items) && booking.items.length > 0) {
    return booking.items.map((item, itemIndex) => ({
      itemId: item._id?.toString(),
      itemIndex,
      courtId: item.courtId?._id || item.courtId,
      courtName: item.courtName || item.courtId?.courtName || "",
      bookingDate: item.bookingDate || booking.bookingDate,
      startTime: item.startTime,
      endTime: item.endTime,
      status: item.status || "ACTIVE",
      price: item.price,
      intervals: item.intervals || [],
    }));
  }
  return [
    {
      itemIndex: 0,
      courtId: booking.courtId?._id || booking.courtId,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      price: booking.price,
      intervals: [],
    },
  ];
};

const getActiveBookingOrders = (booking) =>
  getBookingOrders(booking).filter((order) => order.status !== "CANCELLED");

const getBookingTotalsForActiveItems = (booking, cancelledItemIds = []) => {
  const cancelledItems = new Set(cancelledItemIds.map(String));
  const activeItems = Array.isArray(booking.items)
    ? booking.items.filter(
      (item) =>
        item.status !== "CANCELLED" &&
        !cancelledItems.has(item._id.toString()),
    )
    : [];
  const price = activeItems.reduce(
    (sum, item) => sum + (Number(item.price) || 0),
    0,
  );
  const discount = Math.min(Math.max(0, Number(booking.discount) || 0), price);
  return {
    price,
    discount,
    totalAmount: Math.max(0, price - discount),
  };
};

class BookingService {
  async lockCourts(courtIds, session, lease) {
    if (!session && lease) {
      await lease.lockMore(courtIds);
      return;
    }
    if (!session) {
      throw new Error(
        "A MongoDB session or booking lease is required to acquire booking locks.",
      );
    }
    for (const courtId of [...new Set(courtIds.map(String))].sort()) {
      const lock = await Court.updateOne(
        { _id: courtId, status: "ACTIVE" },
        { $inc: { bookingVersion: 1 } },
        { session },
      );
      if (lock.matchedCount === 0) {
        const err = new Error(
          "Một hoặc nhiều sân không còn hoạt động hoặc không tồn tại.",
        );
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
    const token = require("crypto").randomUUID();
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
              status: "ACTIVE",
              $or: [
                { bookingLockUntil: { $exists: false } },
                { bookingLockUntil: { $lte: now } },
                { bookingLockToken: token, bookingLockUntil: { $gt: now } },
              ],
            },
            {
              $set: { bookingLockToken: token, bookingLockUntil: leaseUntil },
              $inc: { bookingVersion: 1 },
            },
            { returnDocument: "after" },
          )
            .select("_id")
            .lean();
          if (court) {
            acquiredCourtIds.add(courtId);
            acquired = true;
            continue;
          }

          const existingCourt = await Court.findById(courtId)
            .select("status")
            .lean();
          if (!existingCourt || existingCourt.status !== "ACTIVE") {
            const err = new Error(
              "Một hoặc nhiều sân không còn hoạt động hoặc không tồn tại.",
            );
            err.statusCode = 400;
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!acquired) {
          const err = new Error(
            "Lịch sân đang được cập nhật bởi yêu cầu khác. Vui lòng thử lại.",
          );
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
            bookingLockUntil: { $gt: now },
          },
          {
            $set: { bookingLockUntil: new Date(now.getTime() + 5 * 60 * 1000) },
          },
        );
        if (result.matchedCount !== acquiredCourtIds.size) {
          const err = new Error(
            "Không thể bảo vệ lịch sân khỏi yêu cầu đồng thời. Vui lòng thử lại.",
          );
          err.statusCode = 409;
          throw err;
        }
      },
    };

    try {
      await acquire(courtIds);
      return await operation(null, lease);
    } finally {
      if (acquiredCourtIds.size > 0) {
        await Court.updateMany(
          { bookingLockToken: token },
          { $unset: { bookingLockToken: 1, bookingLockUntil: 1 } },
        );
      }
    }
  }

  async assertOrdersAvailable(
    orders,
    bookingDate,
    excludeBookingId,
    session,
    skipScheduleConflict = false,
  ) {
    if (!Array.isArray(orders) || orders.length === 0) {
      const err = new Error("Ngày đặt sân, sân và khung giờ không hợp lệ.");
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
        (!order.bookingDate && !bookingDate) ||
        Number.isNaN(date.getTime()) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.startTime || "") ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.endTime || "") ||
        parseTimeToMinutes(order.startTime) >= parseTimeToMinutes(order.endTime)
      ) {
        const err = new Error("Một hoặc nhiều khung giờ không hợp lệ.");
        err.statusCode = 400;
        throw err;
      }

      const startMinCheck = parseTimeToMinutes(order.startTime);
      const endMinCheck = parseTimeToMinutes(order.endTime);
      if (endMinCheck - startMinCheck < 60) {
        const err = new Error("Thời gian thuê sân tối thiểu là 1 tiếng (60 phút).");
        err.statusCode = 400;
        throw err;
      }
      if (startMinCheck % 15 !== 0 || endMinCheck % 15 !== 0) {
        const err = new Error("Khung giờ thuê sân phải làm tròn theo các mốc 00, 15, 30 hoặc 45 phút.");
        err.statusCode = 400;
        throw err;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      if (startOfDay < today) {
        const err = new Error(
          "Không thể đặt hoặc xác nhận sân cho ngày trong quá khứ.",
        );
        err.statusCode = 400;
        throw err;
      }

      // BUSINESS RULE: Không cho phép đặt sân có giờ bắt đầu nhỏ hơn hoặc bằng thời gian hiện tại
      const now = new Date();
      const startDateTime = getBookingStartDate(
        order.bookingDate || bookingDate,
        order.startTime,
      );
      if (!startDateTime || startDateTime <= now) {
        const err = new Error(
          `Thời gian bắt đầu (${order.startTime}) phải lớn hơn thời gian hiện tại! Không thể đặt hoặc giữ chỗ cho khung giờ trong quá khứ.`,
        );
        err.statusCode = 400;
        throw err;
      }

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      order.bookingDate = date;

      const key = `${order.courtId.toString()}:${startOfDay.toISOString().slice(0, 10)}`;
      const courtOrders = ordersByCourt.get(key) || [];
      if (
        courtOrders.some(
          (existing) =>
            existing.startTime < order.endTime &&
            existing.endTime > order.startTime,
        )
      ) {
        const err = new Error(
          "Đơn có các khung giờ bị trùng trên cùng một sân.",
        );
        err.statusCode = 400;
        throw err;
      }
      courtOrders.push(order);
      ordersByCourt.set(key, courtOrders);
    }

    const courtIds = [
      ...new Set(orders.map((order) => order.courtId.toString())),
    ];
    let courtQuery = Court.find({
      _id: { $in: courtIds },
      status: "ACTIVE",
    }).select("_id courtName status openingTime closingTime");
    if (session) courtQuery = courtQuery.session(session);
    const courts = await courtQuery.lean();
    if (courts.length !== courtIds.length) {
      const err = new Error(
        "Một hoặc nhiều sân trong đơn không còn hoạt động hoặc không tồn tại.",
      );
      err.statusCode = 400;
      throw err;
    }
    const courtMap = new Map(
      courts.map((court) => [court._id.toString(), court]),
    );

    for (const order of orders) {
      const court = courtMap.get(order.courtId.toString());
      const courtEligibility = canBookCourt(
        court,
        order.startTime,
        order.endTime,
      );
      if (!courtEligibility.canBook) {
        const err = new Error(courtEligibility.reason);
        err.statusCode = 400;
        throw err;
      }
      if (skipScheduleConflict) {
        continue;
      }
      const startOfDay = new Date(order.bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(order.bookingDate);
      endOfDay.setHours(23, 59, 59, 999);
      const conflictQuery = this.getScheduleConflictQuery(
        order,
        startOfDay,
        endOfDay,
        excludeBookingId,
      );
      let conflictQueryBuilder = Booking.findOne(conflictQuery).select("_id");
      if (session) conflictQueryBuilder = conflictQueryBuilder.session(session);
      const conflict = await conflictQueryBuilder.lean();
      if (conflict) {
        const err = new Error(
          `Khung giờ ${order.startTime}-${order.endTime} tại ${court?.courtName || "sân"} không còn khả dụng.`,
        );
        err.statusCode = 409;
        throw err;
      }
    }
  }

  getScheduleConflictQuery(
    order,
    startOfDay,
    endOfDay,
    excludeBookingId = null,
  ) {
    const orderCourtId = new mongoose.Types.ObjectId(order.courtId);
    const itemSchedule = {
      courtId: orderCourtId,
      status: { $ne: "CANCELLED" },
      startTime: { $lt: order.endTime },
      endTime: { $gt: order.startTime },
    };
    return {
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
      status: { $in: ["PENDING_APPROVAL", "CONFIRMED", "CHECKED_IN", "COMPLETED"] },
      $or: [
        {
          items: {
            $elemMatch: {
              ...itemSchedule,
              bookingDate: { $gte: startOfDay, $lte: endOfDay },
            },
          },
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          items: {
            $elemMatch: { ...itemSchedule, bookingDate: { $exists: false } },
          },
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          $or: [{ items: { $exists: false } }, { items: { $size: 0 } }],
          courtId: orderCourtId,
          startTime: { $lt: order.endTime },
          endTime: { $gt: order.startTime },
        },
      ],
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
          String(other.courtId?._id || other.courtId) ===
          String(orderCourtId) &&
          new Date(other.bookingDate || booking.bookingDate).getTime() ===
          orderDate.getTime() &&
          other.startTime < order.endTime &&
          other.endTime > order.startTime &&
          other.status !== "CANCELLED";

        const internalConflict = activeOrders.slice(index + 1).find(overlaps);
        if (internalConflict) {
          warnings.push({
            itemId: order.itemId,
            courtName: order.courtName || "",
            bookingDate: orderDate,
            startTime: order.startTime,
            endTime: order.endTime,
            conflictingBookingCode: booking.bookingCode,
          });
          continue;
        }

        const conflictQuery = this.getScheduleConflictQuery(
          { ...order, courtId: orderCourtId },
          startOfDay,
          endOfDay,
          booking._id,
        );
        const candidates = await Booking.find(conflictQuery)
          .select("bookingCode bookingDate startTime endTime courtId items")
          .lean();
        const conflict = candidates.find((candidate) => {
          const candidateOrders = getActiveBookingOrders(candidate);
          return candidateOrders.some((candidateOrder) =>
            overlaps({
              ...candidateOrder,
              bookingDate: candidateOrder.bookingDate || candidate.bookingDate,
            }),
          );
        });
        if (conflict) {
          warnings.push({
            itemId: order.itemId,
            courtName: order.courtName || "",
            bookingDate: orderDate,
            startTime: order.startTime,
            endTime: order.endTime,
            conflictingBookingCode: conflict.bookingCode,
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
      search = "",
      status = "",
      paymentStatus = "",
      courtId = "",
      startDate = "",
      endDate = "",
      bookingDate = "",
      customerId = "",
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = queryParams;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Khách hàng thường chỉ xem đơn của chính họ
    if (currentUser && currentUser.role === "CUSTOMER") {
      filter.customerId = currentUser.userId || currentUser._id;
    } else if (customerId) {
      filter.customerId = customerId;
    }

    // Lọc theo trạng thái đặt sân (chuẩn hóa hỗ trợ cả PENDING và PENDING_APPROVAL)
    if (status && status !== "ALL") {
      if (status === "PENDING" || status === "PENDING_APPROVAL") {
        filter.status = { $in: ["PENDING", "PENDING_APPROVAL"] };
      } else {
        filter.status = status;
      }
    }

    // Lọc theo trạng thái thanh toán
    if (paymentStatus && paymentStatus !== "ALL") {
      filter.paymentStatus = paymentStatus;
    }

    // Lọc theo sân
    if (courtId && courtId !== "ALL") {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ courtId: courtId }, { "items.courtId": courtId }],
      });
    }

    // Lọc theo ngày đặt sân
    if (bookingDate) {
      const start = new Date(bookingDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(bookingDate);
      end.setHours(23, 59, 59, 999);
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { bookingDate: { $gte: start, $lte: end } },
          {
            items: { $elemMatch: { bookingDate: { $gte: start, $lte: end } } },
          },
        ],
      });
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
      filter.$and.push({
        $or: [
          { bookingDate: dateRange },
          { items: { $elemMatch: { bookingDate: dateRange } } },
        ],
      });
    }

    // Tìm kiếm theo từ khóa (Mã đơn hoặc Tên/SĐT/Email khách hàng)
    if (search && search.trim()) {
      const keyword = search.trim();
      const userMatches = await Customer.find({
        $or: [
          { fullName: { $regex: keyword, $options: "i" } },
          { phone: { $regex: keyword, $options: "i" } },
          { email: { $regex: keyword, $options: "i" } },
        ],
      }).select("_id");

      const userIds = userMatches.map((u) => u._id);

      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { bookingCode: { $regex: keyword, $options: "i" } },
          { customerId: { $in: userIds } },
        ],
      });
    }

    // Sắp xếp
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Thực thi truy vấn danh sách bookings
    const [bookings, totalRecords] = await Promise.all([
      Booking.find(filter)
        .populate("customerId", "fullName email phone address")
        .populate("courtId", "courtName courtType location description")
        // CLEAN CODE: Lấy đầy đủ các trường voucher từ MongoDB (code, name, maxDiscountAmount)
        .populate(
          "voucherId",
          "code name maxDiscountAmount voucherCode voucherName discountType discountValue maxDiscount",
        )
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(filter),
    ]);
    if (currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") {
      await this.addAdminConflictWarnings(bookings);
    }

    // Thống kê nhanh theo các trạng thái
    const statsFilter =
      currentUser && currentUser.role === "CUSTOMER"
        ? { customerId: currentUser.userId || currentUser._id }
        : {};

    const [
      totalAll,
      pendingCount,
      confirmedCount,
      checkedInCount,
      completedCount,
      cancelledCount,
      revenueResult,
      invoiceRevenueResult,
    ] = await Promise.all([
      Booking.countDocuments(statsFilter),
      Booking.countDocuments({
        ...statsFilter,
        status: { $in: ["PENDING", "PENDING_APPROVAL"] },
      }),
      Booking.countDocuments({ ...statsFilter, status: "CONFIRMED" }),
      Booking.countDocuments({ ...statsFilter, status: "CHECKED_IN" }),
      Booking.countDocuments({ ...statsFilter, status: "COMPLETED" }),
      Booking.countDocuments({ ...statsFilter, status: "CANCELLED" }),
      Booking.aggregate([
        {
          $match: {
            ...statsFilter,
            paymentStatus: "PAID",
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
          },
        },
      ]),
      // Lấy thêm doanh thu từ các Hóa đơn POS bán lẻ độc lập đã thanh toán (tránh cộng trùng ca đặt sân)
      Invoice.aggregate([
        {
          $match: {
            paymentStatus: "PAID",
            orderType: "POS",
            status: "ACTIVE"
          }
        },
        {
          $group: {
            _id: null,
            totalInvoiceRevenue: { $sum: "$totalAmount" }
          }
        }
      ])
    ]);

    const bookingRev = revenueResult.length > 0 ? (revenueResult[0].totalRevenue || 0) : 0;
    const posRev = invoiceRevenueResult && invoiceRevenueResult.length > 0 ? (invoiceRevenueResult[0].totalInvoiceRevenue || 0) : 0;
    const totalRevenue = bookingRev + posRev;
    return {
      bookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limitNum),
      },
      stats: {
        totalAll,
        pendingCount,
        confirmedCount,
        checkedInCount,
        completedCount,
        cancelledCount,
        totalRevenue,
      },
    };
  }

  /**
   * 2. Lấy chi tiết đơn đặt sân theo ID
   */
  async getBookingById(id, currentUser = null) {
    const booking = await Booking.findById(id)
      .populate("customerId", "fullName email phone address")
      .populate("courtId", "courtName courtType location description")
      // CLEAN CODE: Lấy đầy đủ các trường voucher từ MongoDB
      .populate(
        "voucherId",
        "code name maxDiscountAmount voucherCode voucherName discountType discountValue maxDiscount",
      )
      .lean();

    if (!booking) {
      const err = new Error("Không tìm thấy thông tin đơn đặt sân!");
      err.statusCode = 404;
      throw err;
    }

    // Bảo mật: Nếu là khách hàng, chỉ được xem đơn của chính mình
    if (currentUser && currentUser.role === "CUSTOMER") {
      const customerObjId =
        booking.customerId?._id?.toString() || booking.customerId?.toString();
      const currentUserId =
        currentUser.userId?.toString() || currentUser._id?.toString();
      if (customerObjId !== currentUserId) {
        const err = new Error(
          "Bạn không có quyền truy cập vào đơn đặt sân này!",
        );
        err.statusCode = 403;
        throw err;
      }
    }

    if (currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") {
      return (await this.addAdminConflictWarnings([booking]))[0];
    }
    return booking;
  }

  /**
   * 3. Lấy danh sách sân thi đấu
   */
  async getCourts() {
    return Court.find({})
      .select("_id name courtName courtType location description status operationalStatus")
      .sort({ courtName: 1, name: 1 })
      .lean();
  }

  /**
   * 4. Lấy danh sách khung giờ thi đấu
   */
  async getTimeSlots() {
    return TimeSlot.find({ status: "ACTIVE" }).sort({ startTime: 1 }).lean();
  }

  /**
   * 5. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày
   */
  async getCourtAvailability(courtId, bookingDate, currentUser = null) {
    if (!courtId || !bookingDate) {
      const err = new Error(
        "Vui lòng cung cấp mã sân và ngày đặt!",
      );
      err.statusCode = 400;
      throw err;
    }

    const court = await Court.findById(courtId);
    if (!court) {
      const err = new Error("Không tìm thấy thông tin sân cầu lông!");
      err.statusCode = 404;
      throw err;
    }

    const dateObj = new Date(bookingDate);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? "WEEKEND" : "WEEKDAY";

    const [timeSlots, prices, allCourtPrices, priceRules] = await Promise.all([
      TimeSlot.find({ status: "ACTIVE" }).sort({ startTime: 1 }).lean(),
      Price.find({
        courtId,
        dayType,
        status: "ACTIVE",
      }).lean(),
      Price.find({
        courtId,
        status: "ACTIVE",
      }).lean(),
      PriceRule.find({
        status: "ACTIVE",
        daysOfWeek: dayOfWeek,
      }).lean(),
    ]);

    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const activeBookings = await Booking.find({
      status: { $nin: ["CANCELLED", "REJECTED"] },
      $or: [
        {
          items: {
            $elemMatch: {
              status: { $ne: "CANCELLED" },
              courtId,
              bookingDate: { $gte: startOfDay, $lte: endOfDay },
            },
          },
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          items: {
            $elemMatch: {
              courtId,
              status: { $ne: "CANCELLED" },
              bookingDate: { $exists: false },
            },
          },
        },
        {
          bookingDate: { $gte: startOfDay, $lte: endOfDay },
          courtId,
          $or: [{ items: { $exists: false } }, { items: { $size: 0 } }],
        },
      ],
    })
      .select("courtId bookingDate startTime endTime bookingCode status items")
      .lean();

    const courtPricesPool = prices.length > 0 ? prices : allCourtPrices;
    const courtPricesMin =
      courtPricesPool.length > 0
        ? Math.min(...courtPricesPool.map((p) => p.price))
        : null;
    const candidateRules = priceRules.filter((r) =>
      matchCourtType(r.courtType, court),
    );
    const dbDefaultPrice =
      candidateRules.length > 0
        ? Math.min(...candidateRules.map((r) => r.pricePerHour))
        : priceRules.length > 0
          ? Math.min(...priceRules.map((r) => r.pricePerHour))
          : null;
    const defaultPrice = courtPricesMin || dbDefaultPrice || 0;

    const slotDetails = timeSlots.map((slot) => {
      const priceDoc =
        prices.find(
          (p) =>
            (p.timeSlotId && p.timeSlotId.toString() === slot._id.toString()) ||
            p.timeSlot.includes(slot.startTime),
        ) ||
        allCourtPrices.find(
          (p) =>
            (p.timeSlotId && p.timeSlotId.toString() === slot._id.toString()) ||
            p.timeSlot.includes(slot.startTime),
        );

      let slotPrice;
      if (priceDoc) {
        slotPrice = priceDoc.price;
      } else {
        const matchedRule = priceRules.find((r) => {
          const typeMatches = matchCourtType(r.courtType, court);
          return (
            typeMatches &&
            r.startTime <= slot.startTime &&
            r.endTime >= slot.endTime
          );
        });
        slotPrice = matchedRule ? matchedRule.pricePerHour : defaultPrice;
      }

      const bookedBooking = activeBookings.find((b) => {
        if (Array.isArray(b.items) && b.items.length > 0) {
          return b.items.some((item) => {
            if (item.status === "CANCELLED") return false;
            const itemCourtId =
              item.courtId?._id?.toString() || item.courtId?.toString();
            const itemDate = new Date(item.bookingDate || b.bookingDate);
            if (
              itemCourtId === courtId.toString() &&
              itemDate >= startOfDay &&
              itemDate <= endOfDay
            ) {
              return (
                item.startTime < slot.endTime && item.endTime > slot.startTime
              );
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

      const now = new Date();
      const slotStartAt = getBookingStartDate(bookingDate, slot.startTime);
      const isPast = slotStartAt ? slotStartAt <= now : false;

      const slotDetail = {
        timeSlotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slot.label || `${slot.startTime} - ${slot.endTime}`,
        price: slotPrice,
        dayType,
        isBooked: !!bookedBooking,
        isPast,
        isAvailable: !bookedBooking && !isPast,
      };
      if (currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") {
        slotDetail.bookingCode = bookedBooking
          ? bookedBooking.bookingCode
          : null;
      }
      return slotDetail;
    });
    // Rút trích danh sách khoảng giờ đã đặt (startTime - endTime) để client dùng trực tiếp
    const bookedRanges = [];
    activeBookings.forEach((b) => {
      if (Array.isArray(b.items) && b.items.length > 0) {
        b.items.forEach((item) => {
          if (item.status === "CANCELLED") return;
          const itemCourtId = item.courtId?._id?.toString() || item.courtId?.toString();
          const itemDate = new Date(item.bookingDate || b.bookingDate);
          if (itemCourtId === courtId.toString() && itemDate >= startOfDay && itemDate <= endOfDay) {
            if (item.startTime && item.endTime) {
              bookedRanges.push({ startTime: item.startTime, endTime: item.endTime, bookingCode: b.bookingCode });
            }
          }
        });
      } else {
        const bCourtId = b.courtId?._id?.toString() || b.courtId?.toString();
        if (bCourtId === courtId.toString() && b.startTime && b.endTime) {
          bookedRanges.push({ startTime: b.startTime, endTime: b.endTime, bookingCode: b.bookingCode });
        }
      }
    });

    const bookedRanges = [];
    for (const b of activeBookings) {
      if (Array.isArray(b.items) && b.items.length > 0) {
        for (const item of b.items) {
          const itemCourtId = item.courtId?._id?.toString() || item.courtId?.toString();
          if (item.status !== "CANCELLED" && itemCourtId === courtId.toString()) {
            bookedRanges.push({
              startTime: item.startTime,
              endTime: item.endTime,
              bookingCode: b.bookingCode,
              status: item.status || b.status
            });
          }
        }
      } else {
        const bCourtId = b.courtId?._id?.toString() || b.courtId?.toString();
        if (bCourtId === courtId.toString()) {
          bookedRanges.push({
            startTime: b.startTime,
            endTime: b.endTime,
            bookingCode: b.bookingCode,
            status: b.status
          });
        }
      }
    }

    return {
      court: {
        _id: court._id,
        courtName: court.courtName,
        courtType: court.courtType,
        location: court.location,
        description: court.description,
      },
      bookingDate,
      dayType,
      slots: slotDetails,
      bookedRanges,
    };
  }

  /**
   * 6. Kiểm tra và áp dụng mã giảm giá (Voucher)
   */
  async validateVoucher(voucherCode, orderAmount = 0, context = {}) {
    if (!voucherCode) {
      const err = new Error("Vui lòng cung cấp mã voucher!");
      err.statusCode = 400;
      throw err;
    }

    const code = voucherCode.trim().toUpperCase();
    const voucher = await Voucher.findOne({
      $or: [{ voucherCode: code }, { code }],
      status: "ACTIVE",
    });

    if (!voucher) {
      const err = new Error("Mã giảm giá không tồn tại hoặc đã bị khóa!");
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    if (voucher.startDate && now < new Date(voucher.startDate)) {
      const err = new Error("Mã giảm giá chưa đến thời gian áp dụng!");
      err.statusCode = 400;
      throw err;
    }

    if (voucher.endDate && now > new Date(voucher.endDate)) {
      const err = new Error("Mã giảm giá đã hết hạn sử dụng!");
      err.statusCode = 400;
      throw err;
    }

    if (voucher.usageLimit > 0 && voucher.usedCount >= voucher.usageLimit) {
      const err = new Error("Mã giảm giá đã hết lượt sử dụng!");
      err.statusCode = 400;
      throw err;
    }

    const currentAmount = Number(orderAmount) || 0;
    const applicableTypes = voucher.applicableCourtTypes || ["ALL"];
    let applicableAmount = currentAmount;

    // Phương án A: Kiểm tra loại sân nếu voucher có chỉ định cụ thể
    if (!applicableTypes.includes("ALL")) {
      if (
        Array.isArray(context.courtBreakdowns) &&
        context.courtBreakdowns.length > 0
      ) {
        const matchingBreakdowns = context.courtBreakdowns.filter((cb) =>
          isCourtTypeApplicable(applicableTypes, cb.courtType),
        );
        if (matchingBreakdowns.length === 0) {
          const err = new Error(
            `Mã giảm giá này chỉ áp dụng cho loại sân: ${applicableTypes.join(", ")}!`,
          );
          err.statusCode = 400;
          throw err;
        }
        applicableAmount = matchingBreakdowns.reduce(
          (sum, cb) => sum + cb.totalAmount,
          0,
        );
      } else if (
        Array.isArray(context.courtTypes) &&
        context.courtTypes.length > 0
      ) {
        const hasMatching = context.courtTypes.some((ct) =>
          isCourtTypeApplicable(applicableTypes, ct),
        );
        if (!hasMatching) {
          const err = new Error(
            `Mã giảm giá này chỉ áp dụng cho loại sân: ${applicableTypes.join(", ")}!`,
          );
          err.statusCode = 400;
          throw err;
        }
      }
    }

    const minAmount = voucher.minOrderAmount ?? voucher.minInvoiceAmount ?? 0;
    if (minAmount > 0 && applicableAmount < minAmount) {
      const err = new Error(
        `Đơn đặt sân cho loại sân áp dụng phải có giá trị tối thiểu từ ${minAmount.toLocaleString("vi-VN")}đ để sử dụng mã này!`,
      );
      err.statusCode = 400;
      throw err;
    }

    let discount = 0;
    const maxDiscount = voucher.maxDiscount ?? voucher.maxDiscountAmount ?? 0;
    if (voucher.discountType === "PERCENTAGE") {
      discount = Math.round((applicableAmount * voucher.discountValue) / 100);
      if (maxDiscount > 0 && discount > maxDiscount) {
        discount = maxDiscount;
      }
    } else {
      discount = Math.min(voucher.discountValue, applicableAmount);
    }

    const finalAmount = Math.max(0, currentAmount - discount);

    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode || voucher.code,
      voucherName: voucher.voucherName || voucher.name,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      applicableCourtTypes: voucher.applicableCourtTypes || ["ALL"],
      discount,
      finalAmount,
    };
  }

  /**
   * 6.1. Lấy danh sách mã giảm giá khả dụng và lọc các voucher thỏa điều kiện cho khách hàng
   */
  async getAvailableVouchers({ orderAmount = 0, courtBreakdowns = [], courtTypes = [] } = {}) {
    const now = new Date();
    const vouchers = await Voucher.find({
      status: "ACTIVE",
      $and: [
        {
          $or: [
            { startDate: null },
            { startDate: { $lte: now } }
          ]
        },
        {
          $or: [
            { endDate: null },
            { endDate: { $gte: now } }
          ]
        },
        {
          $or: [
            { usageLimit: null },
            { usageLimit: { $lte: 0 } },
            { $expr: { $lt: ["$usedCount", "$usageLimit"] } }
          ]
        }
      ]
    }).sort({ createdAt: -1 }).lean();

    const currentAmount = Number(orderAmount) || 0;
    const result = [];

    for (const voucher of vouchers) {
      const applicableTypes = voucher.applicableCourtTypes || ["ALL"];
      let applicableAmount = currentAmount;
      let isCourtTypeOk = true;

      if (!applicableTypes.includes("ALL")) {
        if (Array.isArray(courtBreakdowns) && courtBreakdowns.length > 0) {
          const matchingBreakdowns = courtBreakdowns.filter((cb) =>
            isCourtTypeApplicable(applicableTypes, cb.courtType)
          );
          if (matchingBreakdowns.length === 0) {
            isCourtTypeOk = false;
          } else {
            applicableAmount = matchingBreakdowns.reduce(
              (sum, cb) => sum + (cb.totalAmount || 0),
              0
            );
          }
        } else if (Array.isArray(courtTypes) && courtTypes.length > 0) {
          const hasMatching = courtTypes.some((ct) =>
            isCourtTypeApplicable(applicableTypes, ct)
          );
          if (!hasMatching) {
            isCourtTypeOk = false;
          }
        }
      }

      const minAmount = voucher.minOrderAmount ?? voucher.minInvoiceAmount ?? 0;
      const isMinAmountOk = applicableAmount >= minAmount;
      const isEligible = isCourtTypeOk && isMinAmountOk;

      let discount = 0;
      const maxDiscount = voucher.maxDiscount ?? voucher.maxDiscountAmount ?? 0;
      if (voucher.discountType === "PERCENTAGE") {
        discount = Math.round((applicableAmount * voucher.discountValue) / 100);
        if (maxDiscount > 0 && discount > maxDiscount) {
          discount = maxDiscount;
        }
      } else {
        discount = Math.min(voucher.discountValue, applicableAmount);
      }

      result.push({
        _id: voucher._id,
        code: voucher.voucherCode || voucher.code,
        name: voucher.voucherName || voucher.name,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        maxDiscountAmount: maxDiscount,
        minInvoiceAmount: minAmount,
        applicableCourtTypes: applicableTypes,
        calculatedDiscount: discount,
        description: voucher.description || "",
        endDate: voucher.endDate,
        isEligible,
        ineligibleReason: !isCourtTypeOk
          ? `Chỉ áp dụng cho loại sân: ${applicableTypes.join(", ")}`
          : !isMinAmountOk
            ? `Đơn tối thiểu ${minAmount.toLocaleString("vi-VN")} đ`
            : null
      });
    }

    return result;
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
      existingVoucherId,
    } = calcData;

    // Chuẩn hóa danh sách các sân và khung giờ tương ứng của từng sân
    let targetOrders = [];
    if (Array.isArray(courtOrders) && courtOrders.length > 0) {
      targetOrders = courtOrders.map((order) => order || {});
    } else {
      const targetCourtIds =
        Array.isArray(courtIds) && courtIds.length > 0
          ? courtIds
          : courtId
            ? [courtId]
            : [];
      if (startTime && endTime) {
        targetOrders = targetCourtIds.map((cId) => ({
          courtId: cId,
          startTime,
          endTime,
        }));
      }
    }

    if (targetOrders.length === 0) {
      return {
        courtBreakdowns: [],
        totalBasePrice: 0,
        discount: 0,
        finalTotalAmount: 0,
        appliedVoucher: null,
      };
    }
    if (
      targetOrders.some(
        (order) =>
          !order.courtId ||
          !mongoose.Types.ObjectId.isValid(order.courtId) ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.startTime || "") ||
          !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(order.endTime || "") ||
          parseTimeToMinutes(order.startTime) >=
          parseTimeToMinutes(order.endTime),
      )
    ) {
      const err = new Error("Một hoặc nhiều sân hoặc khung giờ không hợp lệ.");
      err.statusCode = 400;
      throw err;
    }

    const uniqueCourtIds = [
      ...new Set(targetOrders.map((o) => o.courtId.toString())),
    ];
    const courts = await Court.find({ _id: { $in: uniqueCourtIds } }).lean();
    const courtMap = new Map(courts.map((c) => [c._id.toString(), c]));

    const dayTypeForOrder = (order) => {
      const orderDate = new Date(
        order.bookingDate || bookingDate || Date.now(),
      );
      const dayOfWeek = orderDate.getDay();
      return dayOfWeek === 0 || dayOfWeek === 6 ? "WEEKEND" : "WEEKDAY";
    };


    const [allPrices, allPriceRules, allTimeSlots] = await Promise.all([
      Price.find({
        courtId: { $in: uniqueCourtIds },
        status: "ACTIVE",
      })
        .populate("timeSlotId")
        .lean(),
      PriceRule.find({ status: "ACTIVE" }).lean(),
      TimeSlot.find({ status: "ACTIVE" }).sort({ startTime: 1 }).lean(),
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
      const isWeekend = dayType === "WEEKEND";
      const orderDate = new Date(
        order.bookingDate || bookingDate || Date.now(),
      );
      const orderStartOfDay = new Date(orderDate);
      orderStartOfDay.setHours(0, 0, 0, 0);
      const orderEndOfDay = new Date(orderDate);
      orderEndOfDay.setHours(23, 59, 59, 999);
      const courtPrices = allPrices.filter(
        (p) =>
          p.courtId.toString() === cIdStr &&
          p.dayType === dayType &&
          (!p.effectiveFrom || new Date(p.effectiveFrom) <= orderEndOfDay) &&
          (!p.effectiveTo || new Date(p.effectiveTo) >= orderStartOfDay),
      );
      const courtAllActivePrices = allPrices.filter(
        (p) =>
          p.courtId.toString() === cIdStr &&
          (!p.effectiveFrom || new Date(p.effectiveFrom) <= orderEndOfDay) &&
          (!p.effectiveTo || new Date(p.effectiveTo) >= orderStartOfDay),
      );

      // Thu thập các mốc phân chia khung giá (boundaries) từ Price và PriceRule trong database
      const points = new Set([bStart, bEnd]);
      courtAllActivePrices.forEach((p) => {
        if (p.timeSlot && p.timeSlot.includes("-")) {
          const [s, e] = p.timeSlot.split("-").map((t) => t.trim());
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
      const courtPricesMin =
        courtPrices.length > 0
          ? Math.min(...courtPrices.map((p) => p.price))
          : courtAllActivePrices.length > 0
            ? Math.min(...courtAllActivePrices.map((p) => p.price))
            : null;
      const candidateRules = allPriceRules.filter((r) => {
        const typeMatches = matchCourtType(r.courtType, court);
        const dayOfWeek = orderDate.getDay();
        return (
          typeMatches &&
          Array.isArray(r.daysOfWeek) &&
          r.daysOfWeek.includes(dayOfWeek)
        );
      });
      const dbBaseRate =
        candidateRules.length > 0
          ? Math.min(...candidateRules.map((r) => r.pricePerHour))
          : null;
      const systemBaseRate =
        allPrices.length > 0 ? Math.min(...allPrices.map((p) => p.price)) : 0;
      const defaultRate = courtPricesMin || dbBaseRate || systemBaseRate;

      for (let i = 0; i < sortedPoints.length - 1; i++) {
        const intStart = sortedPoints[i];
        const intEnd = sortedPoints[i + 1];
        const durMin = intEnd - intStart;
        const durHours = durMin / 60;
        const midPoint = (intStart + intEnd) / 2;

        const matchedPrice = courtPrices.find((p) => {
          if (!p.timeSlot || !p.timeSlot.includes("-")) return false;
          const [s, e] = p.timeSlot.split("-").map((t) => t.trim());
          return (
            parseTimeToMinutes(s) <= midPoint &&
            parseTimeToMinutes(e) >= midPoint
          );
        });

        let hourlyRate;
        let matchedRule = null;
        if (matchedPrice) {
          hourlyRate = matchedPrice.price;
        } else {
          matchedRule = allPriceRules.find((r) => {
            const typeMatches = matchCourtType(r.courtType, court);
            const dayOfWeek = orderDate.getDay();
            return (
              typeMatches &&
              Array.isArray(r.daysOfWeek) &&
              r.daysOfWeek.includes(dayOfWeek) &&
              parseTimeToMinutes(r.startTime) <= midPoint &&
              parseTimeToMinutes(r.endTime) >= midPoint
            );
          });
          if (matchedRule) {
            hourlyRate = matchedRule.pricePerHour;
          } else {
            // Tìm trong bảng giá của sân từ MongoDB cho khung giờ này (ví dụ bảng giá ngày thường)
            const fallbackSlotPrice = courtAllActivePrices.find((p) => {
              if (!p.timeSlot || !p.timeSlot.includes("-")) return false;
              const [s, e] = p.timeSlot.split("-").map((t) => t.trim());
              return (
                parseTimeToMinutes(s) <= midPoint &&
                parseTimeToMinutes(e) >= midPoint
              );
            });
            hourlyRate = fallbackSlotPrice
              ? fallbackSlotPrice.price
              : defaultRate;
          }
        }

        // Tìm TimeSlot tương ứng trong DB để lấy nhãn mô tả
        const matchedSlot =
          matchedPrice?.timeSlotId &&
            typeof matchedPrice.timeSlotId === "object"
            ? matchedPrice.timeSlotId
            : allTimeSlots.find((ts) => {
              const sMin = parseTimeToMinutes(ts.startTime);
              const eMin = parseTimeToMinutes(ts.endTime);
              return sMin <= midPoint && eMin >= midPoint;
            });

        let slotLabel = matchedSlot?.label || "";
        let slotLabelName = "";
        if (slotLabel) {
          const match = slotLabel.match(/\((.*?)\)/);
          slotLabelName = match ? match[1].trim() : slotLabel.trim();
        }

        // Nhận diện giờ cao điểm từ PriceRule / nhãn TimeSlot trong database hoặc độ chênh lệch giá so với giá cơ sở
        const ruleIsPeak =
          matchedRule &&
          /vàng|cao điểm|peak/i.test(
            matchedRule.name + " " + (matchedRule.description || ""),
          );
        const slotIsPeak = /vàng|cao điểm|peak/i.test(slotLabel);
        const isPeak = Boolean(
          ruleIsPeak || slotIsPeak || (!isWeekend && hourlyRate > defaultRate),
        );

        let priceType = "";
        if (matchedRule?.name) {
          priceType =
            isPeak && !/cao điểm|vàng/i.test(matchedRule.name)
              ? `Giờ cao điểm (${matchedRule.name})`
              : matchedRule.name;
        } else if (slotLabelName) {
          priceType = slotLabelName;
        } else if (isPeak) {
          priceType = "Giờ cao điểm (Giờ vàng)";
        } else if (isWeekend) {
          priceType = "Cuối tuần";
        } else {
          priceType = "Giờ thấp điểm (Giờ thường)";
        }
        const amount = Math.round(durHours * hourlyRate);

        rawIntervals.push({
          startTime: formatMinutesToTime(intStart),
          endTime: formatMinutesToTime(intEnd),
          durationMinutes: durMin,
          durationHours: Number(durHours.toFixed(2)),
          priceType,
          hourlyRate,
          amount,
        });
      }

      // Gộp các khoảng giờ liền kề NẾU VÀ CHỈ NẾU cùng đơn giá và cùng loại giá
      const mergedIntervals = [];
      for (const inv of rawIntervals) {
        if (mergedIntervals.length > 0) {
          const prev = mergedIntervals[mergedIntervals.length - 1];
          if (
            prev.hourlyRate === inv.hourlyRate &&
            prev.priceType === inv.priceType &&
            prev.endTime === inv.startTime
          ) {
            prev.endTime = inv.endTime;
            prev.durationMinutes += inv.durationMinutes;
            prev.durationHours = Number((prev.durationMinutes / 60).toFixed(2));
            prev.amount += inv.amount;
            continue;
          }
        }
        mergedIntervals.push({ ...inv });
      }

      const courtTotal = mergedIntervals.reduce(
        (sum, it) => sum + it.amount,
        0,
      );

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
        totalAmount: courtTotal,
      });
    }

    const totalBasePrice = courtBreakdowns.reduce(
      (sum, cb) => sum + cb.totalAmount,
      0,
    );

    // Tính Voucher
    let discount = 0;
    let appliedVoucher = null;

    if (voucherCode && voucherCode.trim()) {
      const code = voucherCode.trim().toUpperCase();
      const voucher = await Voucher.findOne({
        $or: [{ voucherCode: code }, { code }],
        status: "ACTIVE",
      });
      if (voucher) {
        const now = new Date();
        const isValidDate =
          (!voucher.startDate || now >= new Date(voucher.startDate)) &&
          (!voucher.endDate || now <= new Date(voucher.endDate));
        const isExistingVoucher =
          existingVoucherId &&
          voucher._id.toString() === existingVoucherId.toString();
        const hasLimit =
          isExistingVoucher ||
          voucher.usageLimit <= 0 ||
          voucher.usedCount < voucher.usageLimit;

        // Phương án A: Lọc các sân thỏa mãn loại sân áp dụng của voucher
        const applicableTypes = voucher.applicableCourtTypes || ["ALL"];
        const applicableBreakdowns = courtBreakdowns.filter((cb) =>
          isCourtTypeApplicable(applicableTypes, cb.courtType),
        );
        const applicableAmount = applicableBreakdowns.reduce(
          (sum, cb) => sum + cb.totalAmount,
          0,
        );
        const minAmount =
          voucher.minOrderAmount ?? voucher.minInvoiceAmount ?? 0;
        const meetsMinOrder = !minAmount || applicableAmount >= minAmount;

        if (
          isValidDate &&
          hasLimit &&
          applicableBreakdowns.length > 0 &&
          meetsMinOrder
        ) {
          appliedVoucher = {
            voucherId: voucher._id,
            voucherCode: voucher.voucherCode || voucher.code,
            voucherName: voucher.voucherName || voucher.name,
            discountType: voucher.discountType,
            discountValue: voucher.discountValue,
            applicableCourtTypes: applicableTypes,
          };

          const maxDiscount =
            voucher.maxDiscount ?? voucher.maxDiscountAmount ?? 0;
          if (voucher.discountType === "PERCENTAGE") {
            discount = Math.round(
              (applicableAmount * voucher.discountValue) / 100,
            );
            if (maxDiscount > 0 && discount > maxDiscount) {
              discount = maxDiscount;
            }
          } else {
            discount = Math.min(voucher.discountValue, applicableAmount);
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
      appliedVoucher,
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
      paymentMethod = "CASH",
      status: bodyStatus,
      paymentStatus: bodyPaymentStatus,
      note = "",
    } = bookingData;

    let customerId =
      currentUser?.role === "ADMIN" || currentUser?.role === "STAFF"
        ? bodyCustomerId
        : null;

    if (
      (currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") &&
      bodyCustomerId
    ) {
      if (!mongoose.Types.ObjectId.isValid(bodyCustomerId)) {
        const err = new Error("Mã khách hàng không hợp lệ.");
        err.statusCode = 400;
        throw err;
      }
      const targetCustomer = await Customer.findById(bodyCustomerId).select(
        "_id status lockReason",
      );
      if (!targetCustomer) {
        const err = new Error("Không tìm thấy thông tin khách hàng được chọn.");
        err.statusCode = 404;
        throw err;
      }
    }

    // Nếu người dùng đang đăng nhập với quyền CUSTOMER
    if (currentUser && currentUser.role === "CUSTOMER") {
      customerId = currentUser.userId || currentUser._id;
      const activeCustomer = await Customer.findOne({
        _id: customerId,
        status: "ACTIVE",
      }).select("_id");
      if (!activeCustomer) {
        const err = new Error(
          "Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.",
        );
        err.statusCode = 403;
        throw err;
      }
    } else if (!customerId) {
      // Trường hợp khách vãng lai hoặc đặt tại quầy
      if (customerPhone && customerPhone.trim()) {
        const cleanPhone = customerPhone.trim();
        const cleanEmail =
          customerEmail && customerEmail.trim()
            ? customerEmail.trim().toLowerCase()
            : undefined;

        let existingUser = await Customer.findOne({ phone: cleanPhone });
        if (!existingUser) {
          const newUserData = {
            fullName: customerName?.trim() || "Khách vãng lai",
            phone: cleanPhone,
            password: "guest_no_login_needed",
            role: "CUSTOMER",
            status: "ACTIVE",
          };
          if (cleanEmail) {
            newUserData.email = cleanEmail;
          }
          existingUser = await Customer.create(newUserData);
        } else {
          if (existingUser.status !== "ACTIVE") {
            const err = new Error(
              existingUser.lockReason ||
              "Tài khoản liên kết với số điện thoại này đã bị khóa. Vui lòng liên hệ Admin.",
            );
            err.statusCode = 403;
            throw err;
          }
          let needSave = false;
          if (
            customerName &&
            customerName.trim() &&
            existingUser.fullName === "Khách vãng lai"
          ) {
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
      const err = new Error(
        "Vui lòng chọn hoặc cung cấp thông tin khách hàng đặt sân (Họ tên, Số điện thoại)!",
      );
      err.statusCode = 400;
      throw err;
    }

    // Xác định danh sách các sân và khung giờ cần đặt (hỗ trợ cả mảng courtOrders lẫn courtIds / courtId)
    let targetOrders = [];
    if (Array.isArray(courtOrders) && courtOrders.length > 0) {
      targetOrders = courtOrders.map((order) => order || {});
    } else {
      const targetCourtIds =
        Array.isArray(courtIds) && courtIds.length > 0
          ? courtIds
          : courtId
            ? [courtId]
            : [];
      if (startTime && endTime) {
        targetOrders = targetCourtIds.map((cId) => ({
          courtId: cId,
          startTime,
          endTime,
        }));
      }
    }

    const effectiveBookingDate = bookingDate || targetOrders[0]?.bookingDate;
    if (targetOrders.length === 0 || !effectiveBookingDate) {
      const err = new Error(
        "Vui lòng chọn ít nhất một sân thi đấu, Ngày đặt và Khung giờ!",
      );
      err.statusCode = 400;
      throw err;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const ord of targetOrders) {
      const ordDateStr = ord.bookingDate || effectiveBookingDate;
      const ordDateObj = new Date(ordDateStr);
      if (
        !ord.courtId ||
        !mongoose.Types.ObjectId.isValid(ord.courtId) ||
        !ordDateStr ||
        Number.isNaN(ordDateObj.getTime()) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ord.startTime || "") ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ord.endTime || "") ||
        parseTimeToMinutes(ord.startTime) >= parseTimeToMinutes(ord.endTime)
      ) {
        const err = new Error(
          "Một hoặc nhiều sân hoặc khung giờ không hợp lệ.",
        );
        err.statusCode = 400;
        throw err;
      }

      const ordStartMin = parseTimeToMinutes(ord.startTime);
      const ordEndMin = parseTimeToMinutes(ord.endTime);
      if (ordEndMin - ordStartMin < 60) {
        const err = new Error("Thời gian thuê sân tối thiểu là 1 tiếng (60 phút)!");
        err.statusCode = 400;
        throw err;
      }
      if (ordStartMin % 15 !== 0 || ordEndMin % 15 !== 0) {
        const err = new Error("Khung giờ thuê sân phải làm tròn theo các mốc 00, 15, 30 hoặc 45 phút!");
        err.statusCode = 400;
        throw err;
      }
      const ordStartOfDay = new Date(ordDateObj);
      ordStartOfDay.setHours(0, 0, 0, 0);
      if (ordStartOfDay < today) {
        const err = new Error("Không thể đặt sân cho ngày trong quá khứ!");
        err.statusCode = 400;
        throw err;
      }

      // BUSINESS RULE: Không cho phép đặt sân có giờ bắt đầu nhỏ hơn hoặc bằng thời gian hiện tại
      const now = new Date();
      const startDateTime = getBookingStartDate(ordDateObj, ord.startTime);
      if (!startDateTime || startDateTime <= now) {
        const err = new Error(
          `Thời gian bắt đầu đặt sân (${ord.startTime}) phải lớn hơn thời gian hiện tại! Không thể đặt sân trong quá khứ.`,
        );
        err.statusCode = 400;
        throw err;
      }

      ord.bookingDate = ordDateObj;
    }

    const uniqueCourtIds = [
      ...new Set(targetOrders.map((o) => o.courtId.toString())),
    ];
    if (
      (currentUser?.role === "ADMIN" || currentUser?.role === "STAFF") &&
      bodyStatus &&
      !["CONFIRMED", "PENDING_APPROVAL"].includes(bodyStatus)
    ) {
      const err = new Error("Trạng thái tạo đơn không hợp lệ.");
      err.statusCode = 400;
      throw err;
    }

    // 2. Kiểm tra ngày đặt không được trong quá khứ
    const bookingDateObj = new Date(effectiveBookingDate);
    if (!effectiveBookingDate || Number.isNaN(bookingDateObj.getTime())) {
      const err = new Error("Ngày đặt sân không hợp lệ!");
      err.statusCode = 400;
      throw err;
    }

    const checkDate = new Date(bookingDateObj);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate < today) {
      const err = new Error("Không thể đặt sân cho ngày trong quá khứ!");
      err.statusCode = 400;
      throw err;
    }

    const isCustomerOrGuest = !(
      currentUser?.role === "ADMIN" || currentUser?.role === "STAFF"
    );

    const finalStatus = isCustomerOrGuest
      ? "PENDING_APPROVAL"
      : bodyStatus === "PENDING_APPROVAL"
        ? "PENDING_APPROVAL"
        : "CONFIRMED";
    const created = await this.withCourtLocks(
      uniqueCourtIds,
      async (session, lease) => {
        await this.assertOrdersAvailable(
          targetOrders,
          bookingDateObj,
          null,
          session,
          isCustomerOrGuest,
        );
        // CHỈ CHO PHÉP KHÁCH HÀNG (CUSTOMER / GUEST) ÁP DỤNG VOUCHER. ADMIN / STAFF KHÔNG ĐƯỢC ÁP DỤNG.
        const effectiveVoucherCode = isCustomerOrGuest ? voucherCode : undefined;
        const priceCalculation = await this.calculateBookingPrice({
          courtOrders: targetOrders,
          bookingDate: effectiveBookingDate,
          voucherCode: effectiveVoucherCode,
        });
        if (priceCalculation.courtBreakdowns.length !== targetOrders.length) {
          const err = new Error(
            "Không thể tính giá cho đầy đủ sân và khung giờ trong đơn.",
          );
          err.statusCode = 400;
          throw err;
        }

        const { courtBreakdowns, totalBasePrice, discount } = priceCalculation;
        const appliedVoucherId = isCustomerOrGuest
          ? priceCalculation.appliedVoucher?.voucherId || null
          : null;
        if (lease) await lease.ensure();
        if (appliedVoucherId) {
          await Voucher.updateOne(
            { _id: appliedVoucherId },
            { $inc: { usedCount: 1 } },
            session ? { session } : {},
          );
        }

        const dateStr = bookingDateObj
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const bookingCode = `BK${dateStr}${randomSuffix}`;
        const bookingItems = courtBreakdowns.map((cb) => ({
          courtId: cb.courtId,
          courtName: cb.courtName,
          courtType: cb.courtType,
          location: cb.location || "",
          bookingDate: new Date(cb.bookingDate || bookingDateObj),
          status: "ACTIVE",
          startTime: cb.startTime,
          endTime: cb.endTime,
          durationMinutes: cb.durationMinutes,
          durationHours: cb.durationHours,
          price: Number.isFinite(cb.totalAmount) ? cb.totalAmount : 0,
          intervals: cb.intervals || [],
        }));
        const overallStartTime = targetOrders
          .map((order) => order.startTime)
          .sort()[0];
        const overallEndTime = targetOrders
          .map((order) => order.endTime)
          .sort()
          .slice(-1)[0];
        const intervalSummary = courtBreakdowns
          .map((cb) => {
            const intervals = cb.intervals
              .map(
                (it) =>
                  `${it.startTime}-${it.endTime} (${it.priceType}: ${it.amount.toLocaleString("vi-VN")}đ)`,
              )
              .join(", ");
            return `${cb.courtName} [${cb.startTime}-${cb.endTime}: ${intervals}]`;
          })
          .join("; ");
        const combinedNote = note
          ? `${note} | [Chi tiết: ${intervalSummary}]`
          : `[Chi tiết: ${intervalSummary}]`;

        const safeTotalBasePrice = Number.isFinite(totalBasePrice)
          ? totalBasePrice
          : 0;
        const safeDiscount = Number.isFinite(discount) ? discount : 0;
        const safeTotalAmount = Math.max(0, safeTotalBasePrice - safeDiscount);

        const [newBooking] = await Booking.create(
          [
            {
              bookingCode,
              customerId,
              courtId: targetOrders[0].courtId,
              voucherId: appliedVoucherId,
              bookingDate: bookingDateObj,
              startTime: overallStartTime,
              endTime: overallEndTime,
              price: safeTotalBasePrice,
              discount: safeDiscount,
              totalAmount: safeTotalAmount,
              paymentMethod: isCustomerOrGuest ? "CASH" : paymentMethod || "CASH",
              paymentStatus:
                !isCustomerOrGuest && bodyPaymentStatus === "PAID"
                  ? "PAID"
                  : "UNPAID",
              status: finalStatus,
              items: bookingItems,
              note: combinedNote,
            },
          ],
          session ? { session } : {},
        );
        return { booking: newBooking, priceCalculation, bookingCode };
      },
    );

    // 6. Tạo thông báo cho hệ thống
    try {
      const summaryList = created.priceCalculation.courtBreakdowns
        .map((cb) => `${cb.courtName} (${cb.startTime}-${cb.endTime})`)
        .join(", ");
      await Notification.create({
        recipientId: customerId,
        recipientType: "CUSTOMER",
        type: "BOOKING_SUCCESS",
        title: "Đặt sân thành công!",
        message:
          finalStatus === "CONFIRMED"
            ? `Đơn đặt sân #${created.bookingCode} tại ${summaryList} ngày ${bookingDate} đã được xác nhận.`
            : `Yêu cầu đặt sân #${created.bookingCode} tại ${summaryList} ngày ${bookingDate} đang chờ nhân viên duyệt.`,
        isRead: false,
      });

      // Gửi thông báo cho Nhân viên & Quản trị viên (STAFF)
      await Notification.create({
        recipientType: "STAFF",
        type: "BOOKING_NEW",
        title:
          finalStatus === "CONFIRMED"
            ? `Đơn đặt sân mới #${created.bookingCode} đã xác nhận`
            : `Có đơn đặt sân mới #${created.bookingCode} cần duyệt! 🏸`,
        message:
          finalStatus === "CONFIRMED"
            ? `Khách hàng vừa đặt đơn #${created.bookingCode} tại ${summaryList} ngày ${bookingDate}.`
            : `Khách hàng vừa gửi yêu cầu đặt sân #${created.bookingCode} tại ${summaryList} ngày ${bookingDate}. Vui lòng kiểm tra và duyệt giữ sân.`,
        isRead: false,
        status: "ACTIVE",
      });
    } catch (notifErr) {
      console.warn("Không thể tạo thông báo:", notifErr.message);
    }

    const populatedBooking = await this.loadPopulatedBooking(
      created.booking._id,
    ); // CLEAN CODE: Tái sử dụng loadPopulatedBooking

    return {
      ...populatedBooking,
      courtBreakdowns: created.priceCalculation.courtBreakdowns,
      intervals: created.priceCalculation.courtBreakdowns[0]?.intervals || [],
    };
  }

  /**
   * 8. Cập nhật trạng thái đơn đặt sân
   */
  async loadPopulatedBooking(id) {
    return (
      Booking.findById(id)
        .populate("customerId", "fullName email phone address")
        .populate("courtId", "courtName courtType location description")
        .populate("items.courtId", "courtName courtType location description")
        // CLEAN CODE: Lấy đầy đủ các trường voucher từ MongoDB
        .populate(
          "voucherId",
          "code name maxDiscountAmount voucherCode voucherName discountType discountValue maxDiscount",
        )
        .lean()
    );
  }

  // CLEAN CODE: Phân giải danh sách sân cần hủy và xử lý độc lập từng sân dựa trên trạng thái IN_USE thực tế từ MongoDB
  async resolveCancellationOrders(booking, itemIds = null) {
    const activeOrders = getActiveBookingOrders(booking);
    if (activeOrders.length === 0) {
      const err = new Error("Tất cả lịch sân trong đơn này đã được hủy.");
      err.statusCode = 409;
      throw err;
    }

    const allCourtIds = activeOrders
      .map((o) => o.courtId?._id || o.courtId)
      .filter(Boolean);
    const courts = await Court.find({ _id: { $in: allCourtIds } })
      .select("_id courtName operationalStatus status")
      .lean();
    const courtMap = new Map(courts.map((c) => [c._id.toString(), c]));

    const inProgressSessions = await PlayingSession.find({
      bookingId: booking._id,
      courtId: { $in: allCourtIds },
      status: "IN_PROGRESS",
    }).lean();
    const sessionInUseCourtIds = new Set(
      inProgressSessions.map((s) => s.courtId.toString()),
    );

    const isCourtInUse = (order) => {
      const cid = (order.courtId?._id || order.courtId)?.toString();
      const court = courtMap.get(cid);
      return (
        court?.operationalStatus === "IN_USE" ||
        sessionInUseCourtIds.has(cid) ||
        booking.status === "CHECKED_IN"
      );
    };

    // Trường hợp hủy 1 hoặc một số sân cụ thể (itemIds có giá trị)
    if (itemIds != null) {
      const requestedItemIds = Array.isArray(itemIds) ? itemIds : [itemIds];
      if (
        requestedItemIds.length === 0 ||
        requestedItemIds.some(
          (itemId) => !mongoose.Types.ObjectId.isValid(itemId),
        )
      ) {
        const err = new Error("Mã chi tiết lịch sân không hợp lệ.");
        err.statusCode = 400;
        throw err;
      }
      const normalizedItemIds = requestedItemIds.map(String);
      if (new Set(normalizedItemIds).size !== normalizedItemIds.length) {
        const err = new Error("Danh sách chi tiết lịch sân có mã bị lặp.");
        err.statusCode = 400;
        throw err;
      }
      const allOrders = getBookingOrders(booking);
      const selectedOrders = normalizedItemIds.map((itemId) => {
        const selectedOrder = activeOrders.find(
          (order) => order.itemId === itemId,
        );
        if (selectedOrder) return selectedOrder;
        const exists = allOrders.some((order) => order.itemId === itemId);
        const err = new Error(
          exists
            ? "Lịch sân này đã được hủy trước đó."
            : "Không tìm thấy chi tiết lịch sân cần hủy.",
        );
        err.statusCode = exists ? 409 : 404;
        throw err;
      });

      for (const order of selectedOrders) {
        if (isCourtInUse(order)) {
          const err = new Error(
            "Sân đang được sử dụng, không thể hủy sân này.",
          );
          err.statusCode = 409;
          throw err;
        }
      }

      return {
        orders: selectedOrders,
        cancelsWholeBooking: activeOrders.length === selectedOrders.length,
      };
    }

    // Trường hợp hủy toàn bộ booking (itemIds == null)
    const inUseOrders = activeOrders.filter(isCourtInUse);
    const cancellableOrders = activeOrders.filter((o) => !isCourtInUse(o));

    if (cancellableOrders.length === 0) {
      const err = new Error("Sân đang được sử dụng, không thể hủy sân này.");
      err.statusCode = 409;
      throw err;
    }

    return {
      orders: cancellableOrders,
      inUseOrders,
      cancelsWholeBooking: activeOrders.length === cancellableOrders.length,
    };
  }

  // CLEAN CODE: Kiểm tra điều kiện hủy - Chỉ chặn khi sân đang thực sự IN_USE hoặc đơn đã kết thúc/hủy
  async assertBookingItemsCanBeCancelled(booking, orders) {
    if (booking.status === "CANCELLED") {
      const err = new Error("Đơn đặt sân này đã được hủy trước đó.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "REJECTED") {
      const err = new Error("Đơn đặt sân đã bị từ chối.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "COMPLETED") {
      const err = new Error("Đơn đặt sân đã hoàn thành, không thể hủy.");
      err.statusCode = 409;
      throw err;
    }

    const courtIds = orders
      .map((order) => order.courtId?._id || order.courtId)
      .filter(Boolean);
    const courts = await Court.find({ _id: { $in: courtIds } })
      .select("_id courtName operationalStatus status")
      .lean();
    const courtMap = new Map(
      courts.map((court) => [court._id.toString(), court]),
    );

    const inProgressSessions = await PlayingSession.find({
      bookingId: booking._id,
      courtId: { $in: courtIds },
      status: "IN_PROGRESS",
    }).lean();
    const sessionInUseCourtIds = new Set(
      inProgressSessions.map((session) => session.courtId.toString()),
    );

    for (const order of orders) {
      const courtIdStr = (order.courtId?._id || order.courtId)?.toString();
      const court = courtMap.get(courtIdStr);
      const isCourtInUse =
        court?.operationalStatus === "IN_USE" ||
        sessionInUseCourtIds.has(courtIdStr) ||
        booking.status === "CHECKED_IN";

      if (isCourtInUse) {
        const err = new Error("Sân đang được sử dụng, không thể hủy sân này.");
        err.statusCode = 409;
        throw err;
      }
    }
  }

  // CLEAN CODE: Chuẩn bị context hủy đơn của Customer dựa trên MongoDB
  async prepareCustomerCancellationContext(account, booking, itemId = null) {
    const customerId = account._id.toString();
    if (booking.customerId.toString() !== customerId) {
      const err = new Error("Bạn không có quyền hủy đơn đặt sân này.");
      err.statusCode = 403;
      throw err;
    }
    if (booking.status === "CANCELLED") {
      const err = new Error("Đơn đặt sân này đã được hủy trước đó.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "REJECTED") {
      const err = new Error("Đơn đặt sân đã bị từ chối.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "COMPLETED") {
      const err = new Error("Đơn đặt sân đã hoàn thành, không thể hủy.");
      err.statusCode = 409;
      throw err;
    }

    const cancellationTarget = await this.resolveCancellationOrders(
      booking,
      itemId,
    );
    await this.assertBookingItemsCanBeCancelled(
      booking,
      cancellationTarget.orders,
    );

    const cancelledItemIds = cancellationTarget.orders
      .map((order) => order.itemId)
      .filter(Boolean);
    const cancelledAt = new Date();
    const previousStatus = booking.status;
    const cancellationScope = cancellationTarget.cancelsWholeBooking
      ? "BOOKING"
      : "ITEM";
    const recordedItemId =
      itemId ||
      (cancellationScope === "ITEM" && cancellationTarget.orders.length === 1
        ? cancellationTarget.orders[0]?.itemId
        : null);
    const countsTowardMonthlyLimit =
      previousStatus === "CONFIRMED" && cancellationTarget.cancelsWholeBooking;
    const previousCount = countMonthlyConfirmedCancellations(
      account.bookingCancellationHistory,
      cancelledAt,
    );

    if (
      countsTowardMonthlyLimit &&
      previousCount >= CUSTOMER_CANCELLATION_LIMIT
    ) {
      const err = new Error(CUSTOMER_CANCELLATION_LOCK_REASON);
      err.statusCode = 403;
      throw err;
    }

    const cancellationCount = countsTowardMonthlyLimit
      ? previousCount + 1
      : previousCount;
    const accountLocked =
      countsTowardMonthlyLimit &&
      cancellationCount === CUSTOMER_CANCELLATION_LIMIT;

    const audit = {
      bookingId: booking._id,
      bookingCode: booking.bookingCode,
      cancelledAt,
      previousStatus,
      itemId: recordedItemId || null,
      scope: cancellationScope,
      countsTowardMonthlyLimit,
    };

    const nextStatus = cancellationTarget.cancelsWholeBooking
      ? "CANCELLED"
      : previousStatus;
    const totals = getBookingTotalsForActiveItems(booking, cancelledItemIds);

    return {
      cancellationTarget,
      cancelledItemIds,
      cancelledAt,
      previousStatus,
      cancellationScope,
      recordedItemId,
      countsTowardMonthlyLimit,
      cancellationCount,
      accountLocked,
      audit,
      nextStatus,
      totals,
    };
  }

  async sendCustomerCancellationNotification(booking) {
    if (!booking) return;
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: "CUSTOMER",
        type: "BOOKING_CANCELLED",
        title:
          booking.status === "CANCELLED"
            ? "Đơn đặt sân đã bị hủy"
            : "Lịch sân trong đơn đã bị hủy",
        message:
          booking.status === "CANCELLED"
            ? `Đơn đặt sân #${booking.bookingCode} đã được bạn hủy thành công.`
            : `Bạn đã hủy một lịch sân trong đơn #${booking.bookingCode}.`,
        isRead: false,
      });
    } catch (notifErr) {
      // Bỏ qua lỗi notification không làm gián đoạn luồng chính
    }
  }

  async finalizeCustomerCancellation(booking, ctx, id) {
    await this.sendCustomerCancellationNotification(booking);
    const populated = await this.loadPopulatedBooking(id);
    return {
      ...populated,
      cancellationResult: {
        cancellationCount: ctx?.cancellationCount || 0,
        accountLocked: !!ctx?.accountLocked,
        lockReason: ctx?.accountLocked ? CUSTOMER_CANCELLATION_LOCK_REASON : "",
        scope: ctx?.cancellationScope || "BOOKING",
        cancelledItemIds: ctx?.cancelledItemIds || [],
      },
    };
  }

  async cancelBookingAsCustomer(id, currentUser, itemId = null) {
    const customerId = currentUser.userId || currentUser._id;
    const session = await Booking.startSession();
    let committedBooking;
    let cancellationCtx;

    try {
      await session.withTransaction(async () => {
        const account = await Customer.findOne({
          _id: customerId,
          status: "ACTIVE",
        }).session(session);
        if (!account) {
          const err = new Error(
            "Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.",
          );
          err.statusCode = 403;
          throw err;
        }

        const booking = await Booking.findById(id).session(session);
        if (!booking) {
          const err = new Error("Không tìm thấy đơn đặt sân!");
          err.statusCode = 404;
          throw err;
        }

        cancellationCtx = await this.prepareCustomerCancellationContext(
          account,
          booking,
          itemId,
        );
        const targetItemIds = new Set(cancellationCtx.cancelledItemIds);

        if (Array.isArray(booking.items) && booking.items.length > 0) {
          booking.items.forEach((item) => {
            if (targetItemIds.has(item._id.toString()))
              item.status = "CANCELLED";
          });
          booking.status = cancellationCtx.nextStatus;
        } else {
          booking.status = "CANCELLED";
        }

        Object.assign(booking, cancellationCtx.totals);
        booking.cancellationHistory.push({
          cancelledAt: cancellationCtx.cancelledAt,
          cancelledBy: customerId,
          cancelledByRole: "CUSTOMER",
          previousStatus: cancellationCtx.previousStatus,
          itemId: cancellationCtx.recordedItemId || null,
          scope: cancellationCtx.cancellationScope,
          countsTowardMonthlyLimit: cancellationCtx.countsTowardMonthlyLimit,
        });

        if (booking.status === "CANCELLED" && booking.voucherId) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session },
          );
        }
        await booking.save({ session });

        account.bookingCancellationVersion += 1;
        if (cancellationCtx.accountLocked) {
          account.status = 'LOCKED';
          account.lockReason = CUSTOMER_CANCELLATION_LOCK_REASON;
          account.lockedAt = cancellationCtx.cancelledAt;
          account.lockedByBookingId = booking._id;
          account.accountLockHistory.push({
            action: 'LOCKED',
            reason: CUSTOMER_CANCELLATION_LOCK_REASON,
            occurredAt: cancellationCtx.cancelledAt,
            performedBy: customerId,
            bookingId: booking._id
          });
        }
        await account.save({ session });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.cancelBookingAsCustomerWithoutTransaction(
          id,
          customerId,
          itemId,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    try {
      await Notification.create({
        recipientId: committedBooking.customerId,
        recipientType: "CUSTOMER",
        type: "BOOKING_CANCELLED",
        title:
          committedBooking.status === "CANCELLED"
            ? "Đơn đặt sân đã bị hủy"
            : "Lịch sân trong đơn đã bị hủy",
        message:
          committedBooking.status === "CANCELLED"
            ? `Đơn đặt sân #${committedBooking.bookingCode} đã được bạn hủy.`
            : `Bạn đã hủy một lịch sân trong đơn #${committedBooking.bookingCode}.`,
        isRead: false,
      });

      // Gửi thông báo cho Nhân viên & Quản trị viên (STAFF)
      await Notification.create({
        recipientType: "STAFF",
        type: "BOOKING_CANCELLED",
        title:
          committedBooking.status === "CANCELLED"
            ? `Khách hàng vừa hủy đơn đặt sân #${committedBooking.bookingCode}!`
            : `Khách hàng vừa hủy lịch sân trong đơn #${committedBooking.bookingCode}!`,
        message:
          committedBooking.status === "CANCELLED"
            ? `Khách hàng đã hủy đơn đặt sân #${committedBooking.bookingCode}. Khung giờ tại các sân đã được giải phóng trở lại trạng thái trống.`
            : `Khách hàng đã hủy một phần lịch sân trong đơn #${committedBooking.bookingCode}. Khung giờ tương ứng đã được giải phóng.`,
        isRead: false,
        status: "ACTIVE",
      });
    } catch (notifErr) {
      console.warn("Không thể gửi thông báo cập nhật:", notifErr.message);
    }

    const result = await this.loadPopulatedBooking(id);
    return {
      ...result,
      cancellationResult: {
        cancellationCount,
        accountLocked,
        lockReason: accountLocked ? CUSTOMER_CANCELLATION_LOCK_REASON : "",
        scope: cancellationScope,
        cancelledItemIds,
      },
    };
    return this.finalizeCustomerCancellation(
      committedBooking,
      cancellationCtx,
      id,
    );
  }

  async cancelBookingAsCustomerWithoutTransaction(
    id,
    customerId,
    itemId = null,
  ) {
    const token = require("crypto").randomUUID();
    let acquired = false;
    let savedBooking;
    let cancellationCtx;
    const acquireUntil = Date.now() + 5000;

    try {
      while (!acquired && Date.now() < acquireUntil) {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + 30000);
        const account = await Customer.findOneAndUpdate(
          {
            _id: customerId,
            status: "ACTIVE",
            $or: [
              { cancellationLockUntil: { $exists: false } },
              { cancellationLockUntil: null },
              { cancellationLockUntil: { $lte: now } },
            ],
          },
          {
            $set: {
              cancellationLockToken: token,
              cancellationLockUntil: leaseUntil,
            },
          },
          { returnDocument: "after" },
        );
        if (account) {
          acquired = true;
          break;
        }
        const currentAccount = await Customer.findById(customerId)
          .select("status lockReason")
          .lean();
        if (!currentAccount || currentAccount.status !== "ACTIVE") {
          const err = new Error(
            currentAccount?.lockReason ||
            "Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.",
          );
          err.statusCode = 403;
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!acquired) {
        const err = new Error(
          "Yêu cầu hủy khác đang được xử lý. Vui lòng thử lại.",
        );
        err.statusCode = 409;
        throw err;
      }

      const account = await Customer.findOne({
        _id: customerId,
        status: "ACTIVE",
        cancellationLockToken: token,
      });
      const booking = await Booking.findById(id);
      if (!account) {
        const err = new Error(
          "Tài khoản của bạn đã bị khóa hoặc không còn hoạt động. Vui lòng liên hệ Admin.",
        );
        err.statusCode = 403;
        throw err;
      }
      if (!booking) {
        const err = new Error("Không tìm thấy đơn đặt sân!");
        err.statusCode = 404;
        throw err;
      }

      cancellationCtx = await this.prepareCustomerCancellationContext(
        account,
        booking,
        itemId,
      );
      const updateFields = {
        status: cancellationCtx.nextStatus,
        ...cancellationCtx.totals,
      };
      const updateOptions = { returnDocument: "after", runValidators: true };
      if (cancellationCtx.cancelledItemIds.length > 0) {
        updateFields["items.$[cancelTarget].status"] = "CANCELLED";
        const filterIds = cancellationCtx.cancelledItemIds.flatMap((id) => [
          id,
          ...(mongoose.Types.ObjectId.isValid(id)
            ? [new mongoose.Types.ObjectId(id)]
            : []),
        ]);
        updateOptions.arrayFilters = [
          { "cancelTarget._id": { $in: filterIds } },
        ];
      }
      const updated = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          __v: booking.__v,
          status: cancellationCtx.previousStatus,
        },
        {
          $set: updateFields,
          $push: {
            cancellationHistory: {
              cancelledAt: cancellationCtx.cancelledAt,
              cancelledBy: customerId,
              cancelledByRole: "CUSTOMER",
              previousStatus: cancellationCtx.previousStatus,
              itemId: cancellationCtx.recordedItemId || null,
              scope: cancellationCtx.cancellationScope,
              countsTowardMonthlyLimit:
                cancellationCtx.countsTowardMonthlyLimit,
            },
          },
          $inc: { __v: 1 },
        },
        updateOptions,
      );
      if (!updated) {
        const err = new Error(
          "Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.",
        );
        err.statusCode = 409;
        throw err;
      }
      savedBooking = updated;

      const accountUpdate = {
        $push: { bookingCancellationHistory: cancellationCtx.audit },
        $inc: { bookingCancellationVersion: 1 }
      };
      if (cancellationCtx.accountLocked) {
        accountUpdate.$set = {
          status: 'LOCKED',
          lockReason: CUSTOMER_CANCELLATION_LOCK_REASON,
          lockedAt: cancellationCtx.cancelledAt,
          lockedByBookingId: booking._id
        };
        accountUpdate.$push.accountLockHistory = {
          action: 'LOCKED',
          reason: CUSTOMER_CANCELLATION_LOCK_REASON,
          occurredAt: cancellationCtx.cancelledAt,
          performedBy: customerId,
          bookingId: booking._id
        };
      }
      const accountResult = await Customer.updateOne(
        {
          _id: customerId,
          status: "ACTIVE",
          cancellationLockToken: token,
        },
        accountUpdate,
      );
      if (accountResult.modifiedCount !== 1) {
        const rollbackFields = {
          status: cancellationCtx.previousStatus,
          price: booking.price,
          discount: booking.discount,
          totalAmount: booking.totalAmount,
        };
        const rollbackOptions = {};
        if (cancellationCtx.cancelledItemIds.length > 0) {
          rollbackFields["items.$[cancelTarget].status"] = "ACTIVE";
          rollbackOptions.arrayFilters = [
            { "cancelTarget._id": { $in: cancellationCtx.cancelledItemIds } },
          ];
        }
        await Booking.findOneAndUpdate(
          {
            _id: savedBooking._id,
            __v: savedBooking.__v,
            status: cancellationCtx.nextStatus,
          },
          {
            $set: rollbackFields,
            $pull: {
              cancellationHistory: {
                cancelledAt: cancellationCtx.cancelledAt,
                cancelledBy: customerId,
              },
            },
            $inc: { __v: 1 },
          },
          rollbackOptions,
        );
        savedBooking = null;
        const err = new Error(
          "Không thể hoàn tất việc ghi nhận hủy đơn. Đơn đặt sân vẫn được giữ nguyên.",
        );
        err.statusCode = 409;
        throw err;
      }

      if (cancellationCtx.nextStatus === "CANCELLED" && booking.voucherId) {
        await Voucher.updateOne(
          { _id: booking.voucherId },
          { $inc: { usedCount: -1 } },
        );
      }
    } finally {
      if (acquired) {
        await Customer.updateOne(
          { _id: customerId, cancellationLockToken: token },
          { $unset: { cancellationLockToken: 1, cancellationLockUntil: 1 } },
        );
      }
    }

    try {
      await Notification.create({
        recipientId: savedBooking.customerId,
        recipientType: "CUSTOMER",
        type: "BOOKING_CANCELLED",
        title:
          savedBooking.status === "CANCELLED"
            ? "Đơn đặt sân đã bị hủy"
            : "Lịch sân trong đơn đã bị hủy",
        message:
          savedBooking.status === "CANCELLED"
            ? `Đơn đặt sân #${savedBooking.bookingCode} đã được bạn hủy.`
            : `Bạn đã hủy một lịch sân trong đơn #${savedBooking.bookingCode}.`,
        isRead: false,
      });

      // Gửi thông báo cho Nhân viên & Quản trị viên (STAFF)
      await Notification.create({
        recipientType: "STAFF",
        type: "BOOKING_CANCELLED",
        title:
          savedBooking.status === "CANCELLED"
            ? `Khách hàng vừa hủy đơn đặt sân #${savedBooking.bookingCode}!`
            : `Khách hàng vừa hủy lịch sân trong đơn #${savedBooking.bookingCode}!`,
        message:
          savedBooking.status === "CANCELLED"
            ? `Khách hàng đã hủy đơn đặt sân #${savedBooking.bookingCode}. Khung giờ tại các sân đã được giải phóng trở lại trạng thái trống.`
            : `Khách hàng đã hủy một phần lịch sân trong đơn #${savedBooking.bookingCode}. Khung giờ tương ứng đã được giải phóng.`,
        isRead: false,
        status: "ACTIVE",
      });
    } catch (notifErr) {
      console.warn("Không thể gửi thông báo cập nhật:", notifErr.message);
    }

    return this.finalizeCustomerCancellation(savedBooking, cancellationCtx, id);
  }

  // CLEAN CODE: Chuẩn bị dữ liệu và tính toán nghiệp vụ hủy đơn của nhân viên dùng chung
  async prepareStaffCancellationContext(
    booking,
    itemIds,
    currentUser,
    note = null,
  ) {
    const actorId = currentUser.userId || currentUser._id;
    if (booking.status === "CANCELLED") {
      const err = new Error("Đơn đặt sân này đã được hủy trước đó.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "REJECTED") {
      const err = new Error("Đơn đặt sân đã bị từ chối.");
      err.statusCode = 409;
      throw err;
    }
    if (booking.status === "COMPLETED") {
      const err = new Error("Đơn đặt sân đã hoàn thành, không thể hủy.");
      err.statusCode = 409;
      throw err;
    }

    const cancellationTarget = await this.resolveCancellationOrders(
      booking,
      itemIds,
    );
    await this.assertBookingItemsCanBeCancelled(
      booking,
      cancellationTarget.orders,
    );

    const cancelledAt = new Date();
    const cancelledItemIds = cancellationTarget.orders
      .map((order) => order.itemId)
      .filter(Boolean);
    const previousStatus = booking.status;
    const nextStatus = cancellationTarget.cancelsWholeBooking
      ? "CANCELLED"
      : previousStatus;
    const totals = getBookingTotalsForActiveItems(booking, cancelledItemIds);

    const cancellationHistory = cancellationTarget.orders.map((order) => ({
      cancelledAt,
      cancelledBy: actorId,
      cancelledByRole: currentUser.role,
      previousStatus,
      itemId: order.itemId,
      scope: "ITEM",
      countsTowardMonthlyLimit: false,
      note: note || undefined,
    }));

    const cleanNote =
      note && typeof note === "string" && note.trim() ? note.trim() : null;
    const updatedNote = cleanNote
      ? booking.note
        ? `${booking.note} | [Hủy: ${cleanNote}]`
        : `[Hủy: ${cleanNote}]`
      : booking.note;

    return {
      actorId,
      cancellationTarget,
      cancelledAt,
      cancelledItemIds,
      previousStatus,
      nextStatus,
      totals,
      cancellationHistory,
      updatedNote,
    };
  }

  // CLEAN CODE: Định dạng kết quả sau khi nhân viên hủy lịch sân
  async finalizeStaffCancellation(
    booking,
    cancellationTarget,
    isWholeBookingRequest,
    id,
  ) {
    await this.notifyStaffBookingItemsCancelled(
      booking,
      cancellationTarget.orders,
      isWholeBookingRequest,
    );
    return {
      ...(await this.loadPopulatedBooking(id)),
      cancellationResult: {
        scope: isWholeBookingRequest ? "BOOKING" : "ITEMS",
        cancelledItemIds: cancellationTarget.orders
          .map((order) => order.itemId)
          .filter(Boolean),
      },
    };
  }

  async cancelBookingItemsAsStaff(id, currentUser, itemIds, note) {
    const isWholeBookingRequest = itemIds == null;
    const session = await Booking.startSession();
    let committedBooking;
    let staffCtx;

    try {
      await session.withTransaction(async () => {
        const booking = await Booking.findById(id).session(session);
        if (!booking) {
          const err = new Error("Không tìm thấy đơn đặt sân!");
          err.statusCode = 404;
          throw err;
        }
        staffCtx = await this.prepareStaffCancellationContext(
          booking,
          itemIds,
          currentUser,
          note,
        );
        const {
          cancelledItemIds,
          nextStatus,
          totals,
          cancellationHistory,
          updatedNote,
        } = staffCtx;

        if (Array.isArray(booking.items) && booking.items.length > 0) {
          const targetItemIds = new Set(cancelledItemIds);
          booking.items.forEach((item) => {
            if (targetItemIds.has(item._id.toString()))
              item.status = "CANCELLED";
          });
        }
        booking.status = nextStatus;
        if (updatedNote) booking.note = updatedNote;
        Object.assign(booking, totals);

        cancellationHistory.forEach((entry) =>
          booking.cancellationHistory.push(entry),
        );

        if (
          booking.status === "CANCELLED" &&
          !["CANCELLED", "REJECTED"].includes(staffCtx.previousStatus) &&
          booking.voucherId
        ) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session },
          );
        }
        await booking.save({ session });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.cancelBookingItemsAsStaffWithoutTransaction(
          id,
          currentUser,
          itemIds,
          note,
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return this.finalizeStaffCancellation(
      committedBooking,
      staffCtx.cancellationTarget,
      isWholeBookingRequest,
      id,
    );
  }

  async cancelBookingItemsAsStaffWithoutTransaction(
    id,
    currentUser,
    itemIds,
    note = null,
  ) {
    const isWholeBookingRequest = itemIds == null;
    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error("Không tìm thấy đơn đặt sân!");
      err.statusCode = 404;
      throw err;
    }
    const staffCtx = await this.prepareStaffCancellationContext(
      booking,
      itemIds,
      currentUser,
      note,
    );
    const {
      actorId,
      cancellationTarget,
      cancelledAt,
      cancelledItemIds,
      previousStatus,
      nextStatus,
      totals,
      cancellationHistory,
      updatedNote,
    } = staffCtx;

    const updateFields = { status: nextStatus, ...totals };
    if (updatedNote) updateFields.note = updatedNote;
    const filterIds = cancelledItemIds.flatMap((id) => [
      id,
      ...(mongoose.Types.ObjectId.isValid(id)
        ? [new mongoose.Types.ObjectId(id)]
        : []),
    ]);
    const updateOptions = {
      arrayFilters: [{ "cancelTarget._id": { $in: filterIds } }],
      returnDocument: "after",
      runValidators: true,
    };
    updateFields["items.$[cancelTarget].status"] = "CANCELLED";
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, __v: booking.__v, status: previousStatus },
      {
        $set: updateFields,
        $push: { cancellationHistory: { $each: cancellationHistory } },
        $inc: { __v: 1 },
      },
      updateOptions,
    );
    if (!updatedBooking) {
      const err = new Error(
        "Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.",
      );
      err.statusCode = 409;
      throw err;
    }

    if (
      nextStatus === "CANCELLED" &&
      !["CANCELLED", "REJECTED"].includes(previousStatus) &&
      booking.voucherId
    ) {
      try {
        await Voucher.updateOne(
          { _id: booking.voucherId },
          { $inc: { usedCount: -1 } },
        );
      } catch (error) {
        const rollbackFields = {
          status: previousStatus,
          price: booking.price,
          discount: booking.discount,
          totalAmount: booking.totalAmount,
          "items.$[cancelTarget].status": "ACTIVE",
        };
        const rollback = await Booking.findOneAndUpdate(
          {
            _id: updatedBooking._id,
            __v: updatedBooking.__v,
            status: nextStatus,
          },
          {
            $set: rollbackFields,
            $pull: {
              cancellationHistory: {
                cancelledAt,
                cancelledBy: actorId,
              },
            },
            $inc: { __v: 1 },
          },
          { arrayFilters: updateOptions.arrayFilters },
        );
        if (!rollback) {
          const rollbackError = new Error(
            "Không thể cập nhật voucher hoặc khôi phục trạng thái booking; cần kiểm tra dữ liệu booking.",
          );
          rollbackError.statusCode = 500;
          throw rollbackError;
        }
        throw error;
      }
    }

    return this.finalizeStaffCancellation(
      updatedBooking,
      cancellationTarget,
      isWholeBookingRequest,
      id,
    );
  }

  async notifyStaffBookingItemsCancelled(
    booking,
    orders,
    isWholeBookingRequest,
  ) {
    const details = orders
      .map(
        (order) =>
          `${order.courtName || "Sân"} ${order.startTime}-${order.endTime}`,
      )
      .join(", ");
    const isWholeBookingCancelled =
      isWholeBookingRequest || booking.status === "CANCELLED";
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: "CUSTOMER",
        type: "BOOKING_CANCELLED",
        title: isWholeBookingCancelled
          ? "Đơn đặt sân đã bị hủy"
          : "Lịch sân trong đơn đã bị hủy",
        message: isWholeBookingRequest
          ? `Nhân viên đã hủy đơn đặt sân #${booking.bookingCode}.`
          : `Nhân viên đã hủy ${details} trong đơn đặt sân #${booking.bookingCode}.`,
        isRead: false,
      });
    } catch (notifErr) {
      console.warn("Không thể gửi thông báo cập nhật:", notifErr.message);
    }
  }

  // CLEAN CODE: Kiểm tra tính hợp lệ khi chuyển đổi trạng thái đơn và thanh toán
  validateBookingStatusTransition(booking, status, paymentStatus) {
    if (
      status &&
      status === booking.status &&
      ["CANCELLED", "REJECTED"].includes(status)
    ) {
      const err = new Error(
        `Đơn đã ở trạng thái ${status} và không thể xử lý lặp lại.`,
      );
      err.statusCode = 409;
      throw err;
    }

    const transitions = {
      PENDING: ["CONFIRMED", "CANCELLED", "REJECTED"],
      PENDING_APPROVAL: ["CONFIRMED", "CANCELLED", "REJECTED"],
      CONFIRMED: ["CHECKED_IN", "CANCELLED"],
      CHECKED_IN: ["COMPLETED"],
      COMPLETED: [],
      CANCELLED: [],
      REJECTED: [],
    };
    if (
      status &&
      status !== booking.status &&
      !(transitions[booking.status] || []).includes(status)
    ) {
      const err = new Error(
        `Không thể chuyển đơn từ ${booking.status} sang ${status}; đơn đã xử lý không thể duyệt hoặc từ chối lại.`,
      );
      err.statusCode = 409;
      throw err;
    }

    if (paymentStatus) {
      if (paymentStatus === "PAID") {
        if (booking.paymentStatus === "PAID") {
          const err = new Error(
            "Đơn đặt sân này đã được ghi nhận thanh toán trước đó.",
          );
          err.statusCode = 409;
          throw err;
        }
        const effectiveStatus = status || booking.status;
        if (
          !["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(effectiveStatus)
        ) {
          const err = new Error(
            `Không thể ghi nhận thanh toán cho đơn đang ở trạng thái ${booking.status}. Chỉ ghi nhận thanh toán khi đơn đã xác nhận, đang nhận sân hoặc đã hoàn thành.`,
          );
          err.statusCode = 409;
          throw err;
        }
      }
      if (["CANCELLED", "REJECTED"].includes(booking.status) && !status) {
        const err = new Error(
          `Không thể cập nhật thanh toán cho đơn đã bị ${booking.status === "CANCELLED" ? "hủy" : "từ chối"}.`,
        );
        err.statusCode = 409;
        throw err;
      }
    }
  }

  // CLEAN CODE: Định dạng ghi chú khi nhân viên/admin cập nhật đơn
  resolveUpdatedNote(existingNote, status, note, isStaff) {
    if (typeof note !== "string" || !isStaff) return existingNote;
    const cleanNote = note.trim();
    if (!cleanNote) return existingNote;
    return status === "REJECTED"
      ? existingNote
        ? `${existingNote} | ${cleanNote}`
        : cleanNote
      : cleanNote;
  }

  // CLEAN CODE: Gửi thông báo chuyển đổi trạng thái đơn đặt sân
  async sendBookingStatusNotification(booking, status) {
    if (!booking || !["CONFIRMED", "CANCELLED", "REJECTED"].includes(status))
      return;
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: "CUSTOMER",
        type:
          status === "CONFIRMED"
            ? "BOOKING_CONFIRMED"
            : status === "REJECTED"
              ? "BOOKING_REJECTED"
              : "BOOKING_CANCELLED",
        title:
          status === "CONFIRMED"
            ? "Đơn đặt sân đã được duyệt!"
            : status === "REJECTED"
              ? "Yêu cầu đặt sân đã bị từ chối"
              : "Đơn đặt sân đã bị hủy",
        message:
          status === "CONFIRMED"
            ? `Đơn đặt sân #${booking.bookingCode} đã được nhân viên duyệt thành công.`
            : status === "REJECTED"
              ? `Đơn đặt sân #${booking.bookingCode} đã bị từ chối.`
              : `Đơn đặt sân #${booking.bookingCode} đã bị hủy.`,
        isRead: false,
      });
    } catch (notifErr) {
      console.warn("Không thể gửi thông báo cập nhật:", notifErr.message);
    }
  }

  // CLEAN CODE: Cập nhật trạng thái đơn (fallback khi không có replica set)
  async updateBookingStatusWithoutTransaction(
    id,
    updateData,
    currentUser,
    isCustomer,
    isStaff,
  ) {
    const { status, paymentStatus, note } = updateData;
    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error("Không tìm thấy đơn đặt sân!");
      err.statusCode = 404;
      throw err;
    }
    if (
      isCustomer &&
      booking.customerId.toString() !==
      (currentUser.userId || currentUser._id).toString()
    ) {
      const err = new Error("Bạn không có quyền cập nhật đơn đặt sân này.");
      err.statusCode = 403;
      throw err;
    }
    if (isCustomer && status !== "CANCELLED") {
      const err = new Error(
        "Khách hàng chỉ có quyền hủy đơn đặt sân của chính mình.",
      );
      err.statusCode = 403;
      throw err;
    }
    if (status === "CANCELLED") {
      const orders = getActiveBookingOrders(booking);
      await this.assertBookingItemsCanBeCancelled(booking, orders);
    }
    this.validateBookingStatusTransition(booking, status, paymentStatus);
    if (status === "CONFIRMED") {
      const err = new Error(
        "Không thể xác nhận an toàn khi MongoDB không hỗ trợ transaction.",
      );
      err.statusCode = 503;
      throw err;
    }

    const updateFields = {};
    if (status) updateFields.status = status;
    if (paymentStatus) updateFields.paymentStatus = paymentStatus;
    const resolvedNote = this.resolveUpdatedNote(
      booking.note,
      status,
      note,
      isStaff,
    );
    if (resolvedNote !== booking.note) updateFields.note = resolvedNote;

    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, __v: booking.__v, status: booking.status },
      { $set: updateFields, $inc: { __v: 1 } },
      { returnDocument: "after", runValidators: true },
    );
    if (!updatedBooking) {
      const err = new Error(
        "Đơn vừa được cập nhật bởi thao tác khác. Vui lòng tải lại và thử lại.",
      );
      err.statusCode = 409;
      throw err;
    }
    if (
      (status === "CANCELLED" || status === "REJECTED") &&
      !["CANCELLED", "REJECTED"].includes(booking.status) &&
      booking.voucherId
    ) {
      await Voucher.updateOne(
        { _id: booking.voucherId },
        { $inc: { usedCount: -1 } },
      );
    }

    await this.sendBookingStatusNotification(updatedBooking, status);
    return this.loadPopulatedBooking(id);
  }

  /**
   * 8. Cập nhật trạng thái đơn đặt sân
   */
  async updateBookingStatus(id, updateData, currentUser = null) {
    const { status, paymentStatus, note } = updateData;
    const isCustomer = currentUser?.role === "CUSTOMER";
    const isStaff =
      currentUser?.role === "STAFF" || currentUser?.role === "ADMIN";
    if (!isCustomer && !isStaff) {
      const err = new Error("Bạn không có quyền cập nhật đơn đặt sân này.");
      err.statusCode = 403;
      throw err;
    }
    const hasItemId = Object.prototype.hasOwnProperty.call(
      updateData,
      "itemId",
    );
    const hasItemIds = Object.prototype.hasOwnProperty.call(
      updateData,
      "itemIds",
    );
    if (
      isCustomer &&
      (paymentStatus ||
        typeof note === "string" ||
        status !== "CANCELLED" ||
        hasItemIds)
    ) {
      const err = new Error(
        "Khách hàng chỉ có quyền hủy đơn đặt sân của chính mình.",
      );
      err.statusCode = 403;
      throw err;
    }
    if (isCustomer && hasItemId && hasItemIds) {
      const err = new Error("Yêu cầu chỉ được chỉ định một chi tiết lịch sân.");
      err.statusCode = 400;
      throw err;
    }
    if (status === "REJECTED" && !isStaff) {
      const err = new Error(
        "Chỉ Nhân viên hoặc Quản trị viên mới được từ chối đơn đặt sân.",
      );
      err.statusCode = 403;
      throw err;
    }

    const validStatuses = [
      "PENDING",
      "PENDING_APPROVAL",
      "CONFIRMED",
      "CHECKED_IN",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
    ];
    if (status && !validStatuses.includes(status)) {
      const err = new Error("Trạng thái đặt sân không hợp lệ!");
      err.statusCode = 400;
      throw err;
    }
    const validPaymentStatuses = ["UNPAID", "PAID", "REFUNDED"];
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      const err = new Error("Trạng thái thanh toán không hợp lệ!");
      err.statusCode = 400;
      throw err;
    }
    if (isCustomer) {
      return this.cancelBookingAsCustomer(
        id,
        currentUser,
        updateData.itemId || null,
      );
    }
    if (hasItemId || hasItemIds || status === "CANCELLED") {
      const isItemCancellation = hasItemId || hasItemIds;
      const selectedItemIds = hasItemIds
        ? updateData.itemIds
        : hasItemId
          ? updateData.itemId
          : null;
      if (
        status !== "CANCELLED" ||
        (isItemCancellation && paymentStatus) ||
        paymentStatus ||
        (hasItemId && hasItemIds) ||
        (isItemCancellation && selectedItemIds == null)
      ) {
        const err = new Error(
          "Yêu cầu hủy chi tiết chỉ được gửi trạng thái CANCELLED và danh sách chi tiết.",
        );
        err.statusCode = 400;
        throw err;
      }
      return this.cancelBookingItemsAsStaff(
        id,
        currentUser,
        selectedItemIds == null ? null : selectedItemIds,
      );
    }

    let committedBooking;
    if (status === "CONFIRMED") {
      if (!isStaff) {
        const err = new Error(
          "Chỉ Nhân viên hoặc Quản trị viên mới được xác nhận đơn đặt sân.",
        );
        err.statusCode = 403;
        throw err;
      }
      const currentBooking = await Booking.findById(id);
      if (!currentBooking) {
        const err = new Error("Không tìm thấy đơn đặt sân!");
        err.statusCode = 404;
        throw err;
      }
      if (!isPendingBooking(currentBooking.status)) {
        const err = new Error(
          `Không thể xác nhận đơn ở trạng thái ${currentBooking.status}.`,
        );
        err.statusCode = 409;
        throw err;
      }
      const orders = getActiveBookingOrders(currentBooking);
      await this.withCourtLocks(
        orders.map((order) => order.courtId),
        async (session, lease) => {
          const booking = await Booking.findById(id).session(session);
          if (!booking || !isPendingBooking(booking.status)) {
            const err = new Error(
              "Đơn đã được xử lý bởi thao tác khác và không còn chờ duyệt.",
            );
            err.statusCode = 409;
            throw err;
          }
          const latestOrders = getActiveBookingOrders(booking);
          await this.lockCourts(
            latestOrders.map((order) => order.courtId),
            session,
            lease,
          );
          await this.assertOrdersAvailable(
            latestOrders,
            booking.bookingDate,
            booking._id,
            session,
          );
          if (lease) await lease.ensure();
          const updateFields = { status: "CONFIRMED" };
          if (paymentStatus) updateFields.paymentStatus = paymentStatus;
          if (typeof note === "string") updateFields.note = note;
          committedBooking = await Booking.findOneAndUpdate(
            {
              _id: booking._id,
              __v: booking.__v,
              status: { $in: ["PENDING", "PENDING_APPROVAL"] },
            },
            { $set: updateFields, $inc: { __v: 1 } },
            {
              returnDocument: "after",
              runValidators: true,
              ...(session ? { session } : {}),
            },
          );
          if (!committedBooking) {
            const err = new Error(
              "Đơn đã được chỉnh sửa hoặc xử lý bởi thao tác khác. Vui lòng tải lại dữ liệu.",
            );
            err.statusCode = 409;
            throw err;
          }
        },
      );
      await this.sendBookingStatusNotification(committedBooking, "CONFIRMED");
      return this.loadPopulatedBooking(id);
    }

    const result = await Booking.startSession();
    try {
      await result.withTransaction(async () => {
        const booking = await Booking.findById(id).session(result);
        if (!booking) {
          const err = new Error("Không tìm thấy đơn đặt sân!");
          err.statusCode = 404;
          throw err;
        }
        this.validateBookingStatusTransition(booking, status, paymentStatus);

        const previousStatus = booking.status;
        if (status) booking.status = status;
        if (paymentStatus) booking.paymentStatus = paymentStatus;
        const resolvedNote = this.resolveUpdatedNote(
          booking.note,
          status,
          note,
          isStaff,
        );
        if (resolvedNote !== booking.note) booking.note = resolvedNote;

        if (
          (status === "CANCELLED" || status === "REJECTED") &&
          !["CANCELLED", "REJECTED"].includes(previousStatus) &&
          booking.voucherId
        ) {
          await Voucher.updateOne(
            { _id: booking.voucherId },
            { $inc: { usedCount: -1 } },
            { session: result },
          );
        }
        await booking.save({ session: result });
        committedBooking = booking;
      });
    } catch (error) {
      if (isTransactionUnsupported(error)) {
        return this.updateBookingStatusWithoutTransaction(
          id,
          updateData,
          currentUser,
          isCustomer,
          isStaff,
        );
      }
      throw error;
    } finally {
      await result.endSession();
    }

    await this.sendBookingStatusNotification(committedBooking, status);
    return this.loadPopulatedBooking(id);
  }

  /**
   * Customer edits remain pending; staff edits preserve the current booking status.
   */
  async changeBookingInfo(id, changeData, currentUser = null) {
    const isCustomer = currentUser?.role === "CUSTOMER";
    const isStaff =
      currentUser?.role === "STAFF" || currentUser?.role === "ADMIN";
    if (!isCustomer && !isStaff) {
      const err = new Error("Bạn không có quyền chỉnh sửa đơn đặt sân.");
      err.statusCode = 403;
      throw err;
    }

    const originalBooking = await Booking.findById(id);
    if (!originalBooking) {
      const err = new Error("Không tìm thấy yêu cầu đặt sân.");
      err.statusCode = 404;
      throw err;
    }
    if (
      isCustomer &&
      originalBooking.customerId.toString() !==
      (currentUser.userId || currentUser._id).toString()
    ) {
      const err = new Error("Bạn không có quyền chỉnh sửa đơn đặt sân này.");
      err.statusCode = 403;
      throw err;
    }
    if (!isPendingBooking(originalBooking.status)) {
      const err = new Error("Chỉ đơn đang chờ duyệt mới được chỉnh sửa.");
      err.statusCode = 409;
      throw err;
    }
    if (isStaff && changeData.status) {
      const err = new Error(
        "Không thể đổi trạng thái trong khi chỉnh sửa thông tin. Hãy dùng thao tác cập nhật trạng thái riêng.",
      );
      err.statusCode = 400;
      throw err;
    }
    if (
      isCustomer &&
      (changeData.status ||
        changeData.price !== undefined ||
        changeData.discount !== undefined ||
        changeData.totalAmount !== undefined)
    ) {
      const err = new Error(
        "Khách hàng không được tự thay đổi trạng thái hoặc giá của đơn.",
      );
      err.statusCode = 400;
      throw err;
    }

    const previousOrders = getBookingOrders(originalBooking);
    const targetOrders = previousOrders.map((order) => ({ ...order }));
    const itemIndexesUpdated = new Set();
    if (Array.isArray(changeData.courtOrders)) {
      if (changeData.courtOrders.length === 0) {
        const err = new Error("Đơn đặt sân phải có ít nhất một chi tiết.");
        err.statusCode = 400;
        throw err;
      }
      if (isCustomer) {
        targetOrders.length = 0;
        for (const [changeIndex, change] of changeData.courtOrders.entries()) {
          const previousIndex = change?.itemId
            ? previousOrders.findIndex(
              (order) => order.itemId === String(change.itemId),
            )
            : Number.isInteger(change?.itemIndex)
              ? change.itemIndex
              : changeIndex < previousOrders.length
                ? changeIndex
                : -1;
          if (previousIndex >= 0) {
            if (itemIndexesUpdated.has(previousIndex)) {
              const err = new Error("Chi tiết đặt sân bị gửi lặp.");
              err.statusCode = 400;
              throw err;
            }
            itemIndexesUpdated.add(previousIndex);
            if (previousOrders[previousIndex].status === "CANCELLED") {
              targetOrders.push({ ...previousOrders[previousIndex] });
              continue;
            }
            targetOrders.push({
              ...previousOrders[previousIndex],
              ...(change.courtId !== undefined
                ? { courtId: change.courtId }
                : {}),
              ...(change.bookingDate !== undefined
                ? { bookingDate: change.bookingDate }
                : {}),
              ...(change.startTime !== undefined
                ? { startTime: change.startTime }
                : {}),
              ...(change.endTime !== undefined
                ? { endTime: change.endTime }
                : {}),
            });
          } else if (!change?.itemId && !Number.isInteger(change?.itemIndex)) {
            targetOrders.push({
              courtId: change.courtId,
              bookingDate: change.bookingDate || changeData.bookingDate,
              startTime: change.startTime,
              endTime: change.endTime,
            });
          } else {
            const err = new Error("Không tìm thấy chi tiết đặt sân cần sửa.");
            err.statusCode = 400;
            throw err;
          }
        }
        previousOrders.forEach((order) => {
          if (
            order.status === "CANCELLED" &&
            !targetOrders.some((target) => target.itemId === order.itemId)
          ) {
            targetOrders.push({ ...order });
          }
        });
      } else {
        for (const change of changeData.courtOrders) {
          const itemIndex = change?.itemId
            ? targetOrders.findIndex(
              (order) => order.itemId === String(change.itemId),
            )
            : Number.isInteger(change?.itemIndex)
              ? change.itemIndex
              : -1;
          if (
            itemIndex < 0 ||
            itemIndex >= targetOrders.length ||
            itemIndexesUpdated.has(itemIndex)
          ) {
            const err = new Error(
              "Không tìm thấy chi tiết đặt sân cần sửa hoặc chi tiết bị gửi lặp.",
            );
            err.statusCode = 400;
            throw err;
          }
          if (previousOrders.length > 1 && !change.itemId) {
            const err = new Error(
              "Mỗi chi tiết của đơn nhiều sân phải được xác định bằng ID.",
            );
            err.statusCode = 400;
            throw err;
          }
          if (targetOrders[itemIndex].status === "CANCELLED") continue;
          itemIndexesUpdated.add(itemIndex);
          targetOrders[itemIndex] = {
            ...targetOrders[itemIndex],
            ...(change.courtId !== undefined
              ? { courtId: change.courtId }
              : {}),
            ...(change.bookingDate !== undefined
              ? { bookingDate: change.bookingDate }
              : {}),
            ...(change.startTime !== undefined
              ? { startTime: change.startTime }
              : {}),
            ...(change.endTime !== undefined
              ? { endTime: change.endTime }
              : {}),
          };
        }
      }
    } else if (
      changeData.courtId ||
      changeData.startTime ||
      changeData.endTime ||
      changeData.bookingDate
    ) {
      if (isStaff && previousOrders.length > 1) {
        const err = new Error(
          "Vui lòng chọn chi tiết đặt sân cần sửa bằng ID.",
        );
        err.statusCode = 400;
        throw err;
      }
      const firstActiveOrderIndex = targetOrders.findIndex(
        (order) => order.status !== "CANCELLED",
      );
      if (firstActiveOrderIndex < 0) {
        const err = new Error(
          "Đơn đặt sân phải còn ít nhất một lịch chưa bị hủy.",
        );
        err.statusCode = 409;
        throw err;
      }
      targetOrders[firstActiveOrderIndex] = {
        ...targetOrders[firstActiveOrderIndex],
        ...(changeData.courtId ? { courtId: changeData.courtId } : {}),
        ...(changeData.bookingDate
          ? { bookingDate: changeData.bookingDate }
          : {}),
        ...(changeData.startTime ? { startTime: changeData.startTime } : {}),
        ...(changeData.endTime ? { endTime: changeData.endTime } : {}),
      };
    }
    if (changeData.bookingDate) {
      const parsedDate = new Date(changeData.bookingDate);
      if (Number.isNaN(parsedDate.getTime())) {
        const err = new Error("Ngày đặt sân không hợp lệ.");
        err.statusCode = 400;
        throw err;
      }
      targetOrders.forEach((order) => {
        if (order.status !== "CANCELLED") order.bookingDate = parsedDate;
      });
    }
    if (targetOrders.length === 0) {
      const err = new Error("Đơn đặt sân phải có ít nhất một chi tiết.");
      err.statusCode = 400;
      throw err;
    }

    const targetBookingDate = changeData.bookingDate
      ? new Date(changeData.bookingDate)
      : originalBooking.bookingDate;
    const activeTargetOrders = targetOrders.filter(
      (order) => order.status !== "CANCELLED",
    );
    if (activeTargetOrders.length === 0) {
      const err = new Error(
        "Đơn đặt sân phải còn ít nhất một lịch chưa bị hủy.",
      );
      err.statusCode = 409;
      throw err;
    }
    const lockCourtIds = activeTargetOrders.map((order) => order.courtId);
    let savedBooking;
    let priceBreakdowns;
    const oldVoucherId = originalBooking.voucherId?.toString() || "";
    let voucherCode;
    let originalVoucher;
    if (originalBooking.voucherId) {
      originalVoucher = await Voucher.findById(originalBooking.voucherId)
        .select(
          "voucherCode discountType discountValue maxDiscount minOrderAmount usageLimit usedCount startDate endDate status",
        )
        .lean();
      voucherCode = originalVoucher?.voucherCode;
    }

    await this.withCourtLocks(lockCourtIds, async (session, lease) => {
      const booking = await Booking.findById(id).session(session);
      if (!booking || !isPendingBooking(booking.status)) {
        const err = new Error("Đơn đã được xử lý, không thể chỉnh sửa.");
        err.statusCode = 409;
        throw err;
      }
      if (booking.__v !== originalBooking.__v) {
        const err = new Error(
          "Đơn đã được cập nhật bởi thao tác khác. Vui lòng tải lại dữ liệu trước khi sửa.",
        );
        err.statusCode = 409;
        throw err;
      }
      if (
        isCustomer &&
        booking.customerId.toString() !==
        (currentUser.userId || currentUser._id).toString()
      ) {
        const err = new Error("Bạn không có quyền chỉnh sửa đơn đặt sân này.");
        err.statusCode = 403;
        throw err;
      }

      await this.lockCourts(
        targetOrders.map((order) => order.courtId),
        session,
        lease,
      );
      await this.assertOrdersAvailable(
        activeTargetOrders,
        targetBookingDate,
        booking._id,
        session,
        isCustomer,
      );
      const priceCalculation = await this.calculateBookingPrice({
        courtOrders: targetOrders,
        bookingDate: targetBookingDate,
        voucherCode,
        existingVoucherId: oldVoucherId,
      });
      if (priceCalculation.courtBreakdowns.length !== targetOrders.length) {
        const err = new Error(
          "Không thể tính giá cho đầy đủ sân và khung giờ trong đơn.",
        );
        err.statusCode = 400;
        throw err;
      }

      const courtBreakdowns = priceCalculation.courtBreakdowns;
      const items = courtBreakdowns.map((item, index) => {
        const order = targetOrders[index];
        const previous = order.itemId
          ? previousOrders.find((oldOrder) => oldOrder.itemId === order.itemId)
          : Number.isInteger(order.itemIndex)
            ? previousOrders[order.itemIndex]
            : null;
        const sameSchedule =
          previous &&
          String(order.courtId) === String(previous.courtId) &&
          new Date(order.bookingDate).toDateString() ===
          new Date(previous.bookingDate).toDateString() &&
          order.startTime === previous.startTime &&
          order.endTime === previous.endTime;
        const existingIntervals = previous?.intervals || [];
        const calculatedIntervals = item.intervals || [];
        const samePriceConditions =
          previous &&
          existingIntervals.length === calculatedIntervals.length &&
          existingIntervals.every((interval, intervalIndex) => {
            const calculated = calculatedIntervals[intervalIndex];
            return (
              interval.startTime === calculated.startTime &&
              interval.endTime === calculated.endTime &&
              interval.hourlyRate === calculated.hourlyRate &&
              interval.amount === calculated.amount
            );
          });
        const preserveExistingPrice =
          Boolean(previous) &&
          (sameSchedule ||
            (samePriceConditions && previous.price === item.totalAmount));

        return {
          ...(order.itemId ? { _id: order.itemId } : {}),
          courtId: item.courtId,
          courtName: item.courtName,
          courtType: item.courtType,
          location: item.location || "",
          bookingDate: new Date(order.bookingDate),
          status: previous?.status || "ACTIVE",
          startTime: item.startTime,
          endTime: item.endTime,
          durationMinutes: item.durationMinutes,
          durationHours: item.durationHours,
          price: preserveExistingPrice ? previous.price : item.totalAmount,
          intervals: preserveExistingPrice
            ? existingIntervals
            : calculatedIntervals,
        };
      });
      const totalBasePrice = items.reduce(
        (sum, item) => sum + (item.price || 0),
        0,
      );
      let discount = 0;
      const now = new Date();
      const voucherIsApplicable =
        originalVoucher &&
        originalVoucher.status === "ACTIVE" &&
        (!originalVoucher.startDate ||
          now >= new Date(originalVoucher.startDate)) &&
        (!originalVoucher.endDate ||
          now <= new Date(originalVoucher.endDate)) &&
        (!originalVoucher.minOrderAmount ||
          totalBasePrice >= originalVoucher.minOrderAmount) &&
        (originalVoucher.usageLimit <= 0 ||
          originalVoucher.usedCount < originalVoucher.usageLimit ||
          oldVoucherId === originalVoucher._id.toString());

      // Phương án A: Lọc các sân thỏa mãn loại sân của voucher khi đổi sân
      const applicableTypes = originalVoucher?.applicableCourtTypes || ["ALL"];
      const matchingBreakdowns = courtBreakdowns.filter((cb) =>
        isCourtTypeApplicable(applicableTypes, cb.courtType),
      );
      const applicableAmount = matchingBreakdowns.reduce(
        (sum, cb) => sum + cb.totalAmount,
        0,
      );
      const hasValidCourt =
        applicableTypes.includes("ALL") || matchingBreakdowns.length > 0;
      const isStillApplicable = voucherIsApplicable && hasValidCourt;

      if (isStillApplicable && originalVoucher.discountType === "PERCENTAGE") {
        discount = Math.round(
          (applicableAmount * originalVoucher.discountValue) / 100,
        );
        if (originalVoucher.maxDiscount > 0) {
          discount = Math.min(discount, originalVoucher.maxDiscount);
        }
      } else if (isStillApplicable) {
        discount = Math.min(
          originalVoucher.discountValue || 0,
          applicableAmount,
        );
      } else if (!originalBooking.voucherId) {
        discount = Math.min(originalBooking.discount || 0, totalBasePrice);
      }
      discount = Math.min(discount, totalBasePrice);
      const finalTotalAmount = Math.max(0, totalBasePrice - discount);
      if (
        isStaff &&
        finalTotalAmount !== originalBooking.totalAmount &&
        Number(changeData.confirmedTotalAmount) !== finalTotalAmount
      ) {
        const err = new Error(
          `Tổng tiền sau khi chỉnh sửa là ${finalTotalAmount.toLocaleString("vi-VN")}đ. Vui lòng xác nhận mức giá mới trước khi lưu.`,
        );
        err.statusCode = 409;
        throw err;
      }
      const starts = activeTargetOrders.map((order) => order.startTime).sort();
      const ends = activeTargetOrders.map((order) => order.endTime).sort();
      const bookingDates = activeTargetOrders
        .map((order) => new Date(order.bookingDate))
        .sort((a, b) => a - b);
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
        voucherId: voucherIsApplicable ? originalBooking.voucherId : null,
      };
      if (isCustomer) updateFields.status = "PENDING_APPROVAL";
      if (typeof changeData.note === "string")
        updateFields.note = changeData.note;
      if (isStaff && changeData.paymentMethod) {
        updateFields.paymentMethod =
          changeData.paymentMethod === "VIETQR"
            ? "CASH"
            : changeData.paymentMethod;
      }
      savedBooking = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          __v: booking.__v,
          status: { $in: ["PENDING", "PENDING_APPROVAL"] },
        },
        { $set: updateFields, $inc: { __v: 1 } },
        {
          returnDocument: "after",
          runValidators: true,
          ...(session ? { session } : {}),
        },
      );
      if (!savedBooking) {
        const err = new Error(
          "Đơn đã được chỉnh sửa hoặc xử lý bởi thao tác khác. Vui lòng tải lại dữ liệu.",
        );
        err.statusCode = 409;
        throw err;
      }
      const updatedVoucherId = updateFields.voucherId?.toString() || "";
      if (oldVoucherId && oldVoucherId !== updatedVoucherId) {
        await Voucher.updateOne(
          { _id: oldVoucherId },
          { $inc: { usedCount: -1 } },
          session ? { session } : {},
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
        const scheduleSummary = savedBooking.items
          .map(
            (item) =>
              `${item.courtName} ngày ${new Date(item.bookingDate || savedBooking.bookingDate).toLocaleDateString("vi-VN")} (${item.startTime}-${item.endTime})`,
          )
          .join("; ");
        await Notification.create({
          recipientId: savedBooking.customerId,
          recipientType: "CUSTOMER",
          type: "BOOKING_UPDATED",
          title: "Thông tin đơn đặt sân đã thay đổi",
          message: `Đơn đặt sân #${savedBooking.bookingCode} đã được cập nhật: ${scheduleSummary}. Tổng tiền: ${savedBooking.totalAmount.toLocaleString("vi-VN")}đ. Trạng thái đơn vẫn là ${savedBooking.status}.`,
          isRead: false,
        });
      } catch (notifErr) {
        notificationSent = false;
      }
    } else if (isCustomer) {
      try {
        const scheduleSummary = savedBooking.items
          .map(
            (item) =>
              `${item.courtName} ngày ${new Date(item.bookingDate || savedBooking.bookingDate).toLocaleDateString("vi-VN")} (${item.startTime}-${item.endTime})`,
          )
          .join("; ");
        await Notification.create({
          recipientType: "STAFF",
          type: "BOOKING_UPDATED",
          title: `Khách hàng vừa cập nhật đơn đặt sân #${savedBooking.bookingCode}`,
          message: `Khách hàng đã thay đổi lịch đặt sân đơn #${savedBooking.bookingCode}: ${scheduleSummary}. Tổng tiền: ${savedBooking.totalAmount.toLocaleString("vi-VN")}đ.`,
          isRead: false,
          status: "ACTIVE",
        });
      } catch (notifErr) {
        notificationSent = false;
      }
    }

    return {
      booking: {
        ...(await this.loadPopulatedBooking(id)),
        courtBreakdowns: priceBreakdowns,
      },
      notificationSent,
    };
  }

  /**
   * 10. AF2: Từ chối yêu cầu đặt sân (Reject Booking)
   */
  async rejectBooking(id, reason = "", currentUser = null) {
    const booking = await this.updateBookingStatus(
      id,
      {
        status: "REJECTED",
        note: reason ? `Lý do từ chối: ${reason.trim()}` : undefined,
      },
      currentUser,
    );
    return { booking, notificationSent: true };
  }

  /**
   * 11. Lấy danh sách khách hàng phục vụ staff / admin đặt sân
   */
  async getCustomers(currentUser = null) {
    if (
      currentUser &&
      currentUser.role !== "ADMIN" &&
      currentUser.role !== "STAFF"
    ) {
      const err = new Error(
        "Bạn không có quyền truy cập danh sách khách hàng.",
      );
      err.statusCode = 403;
      throw err;
    }
    return Customer.find({})
      .select("fullName phone email address")
      .sort({ fullName: 1 })
      .lean();
  }
}

module.exports = new BookingService();
