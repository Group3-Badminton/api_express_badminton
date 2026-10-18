const Booking = require('../models/booking');
const Court = require('../models/court');
const User = require('../models/user');
const TimeSlot = require('../models/timeSlot');
const Price = require('../models/price');
const Voucher = require('../models/voucher');
const Notification = require('../models/notification');

class BookingService {
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
  async getCourtAvailability(courtId, bookingDate) {
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

    const timeSlots = await TimeSlot.find({ status: 'ACTIVE' }).sort({ startTime: 1 }).lean();

    const prices = await Price.find({
      courtId,
      dayType,
      status: 'ACTIVE'
    }).lean();

    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const activeBookings = await Booking.find({
      courtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).select('startTime endTime bookingCode status').lean();

    const slotDetails = timeSlots.map((slot) => {
      const priceDoc = prices.find(
        (p) =>
          (p.timeSlotId && p.timeSlotId.toString() === slot._id.toString()) ||
          p.timeSlot.includes(slot.startTime)
      );

      const defaultPrice = isWeekend ? 140000 : 100000;
      const slotPrice = priceDoc ? priceDoc.price : defaultPrice;

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
    const voucher = await Voucher.findOne({ voucherCode: code, status: 'ACTIVE' });

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
    if (voucher.minOrderAmount > 0 && currentAmount < voucher.minOrderAmount) {
      const err = new Error(
        `Đơn đặt sân phải có giá trị tối thiểu từ ${voucher.minOrderAmount.toLocaleString('vi-VN')}đ để sử dụng mã này!`
      );
      err.statusCode = 400;
      throw err;
    }

    let discount = 0;
    if (voucher.discountType === 'PERCENTAGE') {
      discount = Math.round((currentAmount * voucher.discountValue) / 100);
      if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
        discount = voucher.maxDiscount;
      }
    } else {
      discount = Math.min(voucher.discountValue, currentAmount);
    }

    const finalAmount = Math.max(0, currentAmount - discount);

    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode,
      voucherName: voucher.voucherName,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discount,
      finalAmount
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
      bookingDate,
      startTime,
      endTime,
      voucherCode,
      voucherId: bodyVoucherId,
      price: customPrice,
      paymentMethod = 'CASH',
      status: bodyStatus,
      note = ''
    } = bookingData;

    let customerId = bodyCustomerId;

    // Nếu người dùng đang đăng nhập với quyền CUSTOMER
    if (currentUser && currentUser.role === 'CUSTOMER') {
      customerId = currentUser.userId || currentUser._id;
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
          // Gmail ở khách vãng lai được quyền không có (chỉ gán nếu có giá trị)
          if (cleanEmail) {
            newUserData.email = cleanEmail;
          }

          existingUser = await User.create(newUserData);
        } else {
          // Nếu đã tồn tại khách có SĐT này, cập nhật thêm email/họ tên nếu trước đó chưa có
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

    if (!courtId || !bookingDate || !startTime || !endTime) {
      const err = new Error('Vui lòng cung cấp đầy đủ thông tin: Sân, Ngày đặt và Khung giờ!');
      err.statusCode = 400;
      throw err;
    }

    if (startTime >= endTime) {
      const err = new Error('Thời gian kết thúc phải sau thời gian bắt đầu!');
      err.statusCode = 400;
      throw err;
    }

    // 1. Kiểm tra tồn tại Sân
    const court = await Court.findById(courtId);
    if (!court || court.status !== 'ACTIVE') {
      const err = new Error('Sân được chọn hiện không khả dụng hoặc đang bảo trì!');
      err.statusCode = 400;
      throw err;
    }

    // 2. Kiểm tra ngày đặt không được trong quá khứ
    const bookingDateObj = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(bookingDateObj);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate < today) {
      const err = new Error('Không thể đặt sân cho ngày trong quá khứ!');
      err.statusCode = 400;
      throw err;
    }

    // 3. Kiểm tra trùng lịch (CONFLICT CHECK - Khoảng thời gian không bị chồng lấn)
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingBooking = await Booking.findOne({
      courtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['CANCELLED', 'REJECTED'] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });

    if (existingBooking) {
      const err = new Error(
        `Thời gian ${startTime} - ${endTime} tại ${court.courtName} đã bị trùng với đơn đặt trước (${existingBooking.startTime} - ${existingBooking.endTime}, Mã: #${existingBooking.bookingCode}). Vui lòng chọn thời gian khác!`
      );
      err.statusCode = 400;
      throw err;
    }

    // 4. Tính giá tiền tự động theo khung giờ và sân
    const dayOfWeek = bookingDateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    let basePrice = 0;
    const priceDoc = await Price.findOne({
      courtId,
      dayType,
      $or: [
        { timeSlot: { $regex: startTime } },
        { timeSlot: '' }
      ],
      status: 'ACTIVE'
    });

    if (priceDoc) {
      basePrice = priceDoc.price;
    } else if (customPrice && Number(customPrice) > 0) {
      basePrice = Number(customPrice);
    } else {
      basePrice = isWeekend ? 140000 : 100000;
    }

    // 5. Xử lý Voucher & Giảm giá
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
          voucher.usedCount += 1;
          await voucher.save();
        }
      }
    }

    const totalAmount = Math.max(0, basePrice - discount);

    // 6. Sinh mã đặt sân tự động
    const dateStr = bookingDateObj.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const bookingCode = `BK${dateStr}${randomSuffix}`;

    const finalStatus = bodyStatus || 'CONFIRMED';
    const finalPaymentStatus = 'UNPAID';

    // 7. Lưu đơn đặt sân
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
      paymentMethod: paymentMethod === 'VIETQR' ? 'CASH' : (paymentMethod || 'CASH'),
      paymentStatus: finalPaymentStatus,
      status: finalStatus,
      note
    });

    // 8. Tạo thông báo cho hệ thống
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

    return Booking.findById(newBooking._id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();
  }

  /**
   * 8. Cập nhật trạng thái đơn đặt sân
   */
  async updateBookingStatus(id, updateData) {
    const { status, paymentStatus, note } = updateData;

    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error('Không tìm thấy đơn đặt sân!');
      err.statusCode = 404;
      throw err;
    }

    const validStatuses = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REJECTED'];
    if (status && !validStatuses.includes(status)) {
      const err = new Error('Trạng thái đặt sân không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

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
        const err = new Error(
          `Trạng thái đặt sân chỉ được cập nhật đúng chiều theo quy trình (hiện tại: ${booking.status}), không được chuyển ngược lại thành ${status}!`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    const validPaymentStatuses = ['UNPAID', 'PAID', 'REFUNDED'];
    if (paymentStatus && !validPaymentStatuses.includes(paymentStatus)) {
      const err = new Error('Trạng thái thanh toán không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    // Nếu đơn bị hủy/từ chối và trước đó có dùng voucher, hoàn lại 1 lượt dùng
    if (
      (status === 'CANCELLED' || status === 'REJECTED') &&
      booking.status !== 'CANCELLED' &&
      booking.status !== 'REJECTED' &&
      booking.voucherId
    ) {
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

    return Booking.findById(id)
      .populate('customerId', 'fullName email phone address')
      .populate('courtId', 'courtName courtType location description')
      .populate('voucherId', 'voucherCode voucherName discountType discountValue')
      .lean();
  }

  /**
   * 9. AF1: Thay đổi thông tin đặt sân (Change Booking Information)
   */
  async changeBookingInfo(id, changeData) {
    const {
      courtId,
      bookingDate,
      startTime,
      endTime,
      note,
      price,
      discount: bodyDiscount,
      totalAmount: bodyTotalAmount,
      paymentMethod
    } = changeData;

    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error('Không tìm thấy yêu cầu đặt sân. Vui lòng kiểm tra thông tin đặt sân và thử lại.');
      err.statusCode = 404;
      throw err;
    }

    if (booking.status !== 'PENDING') {
      const err = new Error('Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận và không thể tiếp tục xử lý.');
      err.statusCode = 400;
      throw err;
    }

    const targetCourtId = courtId || booking.courtId;
    const targetBookingDate = bookingDate ? new Date(bookingDate) : booking.bookingDate;
    const targetStartTime = startTime || booking.startTime;
    const targetEndTime = endTime || booking.endTime;

    const court = await Court.findById(targetCourtId);
    if (!court || court.status !== 'ACTIVE') {
      const err = new Error('Sân đã chọn không còn khả dụng cho yêu cầu đặt sân này. Vui lòng chọn sân khác hoặc phương án đặt sân khác.');
      err.statusCode = 400;
      throw err;
    }

    if (targetStartTime >= targetEndTime) {
      const err = new Error('Thời gian kết thúc phải sau thời gian bắt đầu!');
      err.statusCode = 400;
      throw err;
    }

    const startOfDay = new Date(targetBookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetBookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const conflictingBooking = await Booking.findOne({
      _id: { $ne: booking._id },
      courtId: targetCourtId,
      bookingDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['CANCELLED', 'REJECTED'] },
      startTime: { $lt: targetEndTime },
      endTime: { $gt: targetStartTime }
    });

    if (conflictingBooking) {
      const err = new Error(
        `Thời gian ${targetStartTime} - ${targetEndTime} tại ${court.courtName} đã bị trùng với đơn đặt khác (${conflictingBooking.startTime} - ${conflictingBooking.endTime}, Mã: #${conflictingBooking.bookingCode}). Vui lòng chọn thời gian khác!`
      );
      err.statusCode = 400;
      throw err;
    }

    const dayOfWeek = new Date(targetBookingDate).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';

    let basePrice = 0;
    const priceDoc = await Price.findOne({
      courtId: targetCourtId,
      dayType,
      $or: [
        { timeSlot: { $regex: targetStartTime } },
        { timeSlot: '' }
      ],
      status: 'ACTIVE'
    });

    if (price !== undefined && Number(price) >= 0) {
      basePrice = Number(price);
    } else if (priceDoc) {
      basePrice = priceDoc.price;
    } else {
      basePrice = isWeekend ? 140000 : 100000;
    }

    let discount = 0;
    if (bodyDiscount !== undefined && Number(bodyDiscount) >= 0) {
      discount = Number(bodyDiscount);
    } else if (booking.voucherId) {
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

    discount = Math.min(discount, basePrice);
    const totalAmount = bodyTotalAmount !== undefined && Number(bodyTotalAmount) >= 0
      ? Number(bodyTotalAmount)
      : Math.max(0, basePrice - discount);

    booking.courtId = targetCourtId;
    booking.bookingDate = targetBookingDate;
    booking.startTime = targetStartTime;
    booking.endTime = targetEndTime;
    booking.price = basePrice;
    booking.discount = discount;
    booking.totalAmount = totalAmount;
    if (paymentMethod) {
      booking.paymentMethod = paymentMethod === 'VIETQR' ? 'CASH' : paymentMethod;
    }
    if (typeof note === 'string') booking.note = note;
    booking.status = 'CONFIRMED';

    await booking.save();

    let notificationSent = true;
    try {
      await Notification.create({
        recipientId: booking.customerId,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_CONFIRMED',
        title: 'Đơn đặt sân đã được xác nhận',
        message: `Đơn đặt sân #${booking.bookingCode} đã được cập nhật sang sân ${court.courtName}, ngày ${new Date(targetBookingDate).toLocaleDateString('vi-VN')}, khung giờ ${targetStartTime} - ${targetEndTime} và đã được xác nhận thành công.`,
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

    return {
      booking: updatedBooking,
      notificationSent
    };
  }

  /**
   * 10. AF2: Từ chối yêu cầu đặt sân (Reject Booking)
   */
  async rejectBooking(id, reason = '') {
    const booking = await Booking.findById(id);
    if (!booking) {
      const err = new Error('Không tìm thấy yêu cầu đặt sân. Vui lòng kiểm tra thông tin đặt sân và thử lại.');
      err.statusCode = 404;
      throw err;
    }

    if (booking.status !== 'PENDING') {
      const err = new Error('Yêu cầu đặt sân không còn ở trạng thái chờ xác nhận và không thể tiếp tục xử lý.');
      err.statusCode = 400;
      throw err;
    }

    booking.status = 'REJECTED';
    if (reason && reason.trim()) {
      booking.note = booking.note
        ? `${booking.note} | Lý do từ chối: ${reason.trim()}`
        : `Lý do từ chối: ${reason.trim()}`;
    }

    if (booking.voucherId) {
      await Voucher.findByIdAndUpdate(booking.voucherId, { $inc: { usedCount: -1 } });
    }

    await booking.save();

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

    return {
      booking: updatedBooking,
      notificationSent
    };
  }

  /**
   * 11. Lấy danh sách khách hàng phục vụ staff / admin đặt sân
   */
  async getCustomers() {
    return User.find({ role: 'CUSTOMER' })
      .select('fullName phone email address')
      .sort({ fullName: 1 })
      .lean();
  }
}

module.exports = new BookingService();
