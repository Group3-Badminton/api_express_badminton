const PlayingSession = require('../models/playingSession');
const Booking = require('../models/booking');
const Court = require('../models/court');
const Customer = require('../models/customer');
const Staff = require('../models/staff');
const TimeSlot = require('../models/timeSlot');
const Price = require('../models/price');
const PriceRule = require('../models/priceRule');
const Invoice = require('../models/invoice');
const Product = require('../models/product');
const Notification = require('../models/notification');
const bookingService = require('../services/bookingService');
const { sendSuccess, sendError } = require('../utils/response');
const {
  scheduleSessionNearEndWarning,
  cancelSessionWarning,
  scheduleAutoCleanFinish,
  autoCancelLateBookings
} = require('../schedulers/sessionScheduler');

// Tra cứu giá sân theo giờ từ MongoDB (Price / PriceRule) thay vì hardcode
async function getHourlyRate(court, date = new Date(), timeStr = '') {
  try {
    const day = new Date(date).getDay();
    const isWeekend = day === 0 || day === 6;
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';
    const courtId = court?._id || court;

    // 1. Tìm trong bảng Price của chính sân đó
    if (courtId) {
      const priceFilter = { courtId, status: 'ACTIVE' };
      const courtPrices = await Price.find(priceFilter).lean();
      if (courtPrices.length > 0) {
        const exactPrice = courtPrices.find((p) => p.dayType === dayType && (!timeStr || (p.timeSlot && p.timeSlot.includes(timeStr))));
        if (exactPrice) return exactPrice.price;
        const dayTypePrice = courtPrices.find((p) => p.dayType === dayType);
        if (dayTypePrice) return dayTypePrice.price;
        return courtPrices[0].price;
      }
    }

    // 2. Tìm trong PriceRule theo courtType
    const courtDoc = typeof court === 'object' && court?.courtType ? court : await Court.findById(courtId).select('courtType').lean();
    const courtType = courtDoc?.courtType || 'STANDARD';
    const rules = await PriceRule.find({
      status: 'ACTIVE',
      daysOfWeek: day
    }).lean();

    if (rules.length > 0) {
      const matchedRule = rules.find((r) => r.courtType === courtType || r.courtType === 'ALL');
      if (matchedRule) return matchedRule.pricePerHour;
      return rules[0].pricePerHour;
    }

    // 3. Fallback theo bảng Price chung bất kỳ trong hệ thống
    const anyPrice = await Price.findOne({ status: 'ACTIVE' }).lean();
    if (anyPrice) return anyPrice.price;

    return 80000;
  } catch (err) {
    console.warn('Lỗi tra cứu giá sân từ MongoDB, dùng giá dự phòng:', err.message);
    const day = new Date(date).getDay();
    return (day === 0 || day === 6) ? 140000 : 100000;
  }
}

function normalizeCourtType(type) {
  if (!type) return 'STANDARD';
  const t = String(type).trim().toUpperCase();
  if (t === 'VIP' || t.includes('VIP') || t.includes('GỖ')) return 'VIP';
  if (t === 'PREMIUM' || t.includes('PREMIUM') || t.includes('THI ĐẤU') || t.includes('PVC')) return 'PREMIUM';
  return 'STANDARD';
}

function getCourtTypeName(normType) {
  if (normType === 'VIP') return 'Sân VIP';
  if (normType === 'PREMIUM') return 'Sân Thi Đấu';
  return 'Sân Tiêu Chuẩn';
}

async function calculateIntervalPrice(court, startTime, endTime, date = new Date()) {
  try {
    const calc = await bookingService.calculateBookingPrice({
      courtOrders: [{
        courtId: court._id || court,
        startTime,
        endTime
      }],
      bookingDate: date
    });
    if (calc && typeof calc.totalBasePrice === 'number' && calc.totalBasePrice > 0) {
      return calc.totalBasePrice;
    }
  } catch (err) {
  }

  const courtType = normalizeCourtType(court?.courtType);
  const day = new Date(date).getDay();
  const rule = await PriceRule.findOne({
    courtType: { $in: [courtType, 'ALL'] },
    daysOfWeek: day,
    status: 'ACTIVE'
  }).sort({ pricePerHour: -1 });

  let ratePerHour = rule?.pricePerHour;
  if (!ratePerHour) {
    const fallbackRule = await PriceRule.findOne({
      courtType: { $in: [courtType, 'ALL'] },
      status: 'ACTIVE'
    }).sort({ pricePerHour: -1 });
    if (fallbackRule) {
      ratePerHour = fallbackRule.pricePerHour;
    } else {
      const anyRule = await PriceRule.findOne({ status: 'ACTIVE' });
      ratePerHour = anyRule?.pricePerHour || 100000;
    }
  }
  const [sh, sm] = (startTime || '00:00').split(':').map(Number);
  const [eh, em] = (endTime || '00:00').split(':').map(Number);
  const durationMinutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  return Math.round((ratePerHour / 60) * durationMinutes);
}

function extractCustomerDisplayInfo(booking, fallbackUser = null) {
  let customerDisplayName = fallbackUser?.fullName || booking?.customerId?.fullName || 'Khách vãng lai';
  let customerDisplayPhone = fallbackUser?.phone || booking?.customerId?.phone || '';
  let isWalkIn = false;

  const note = booking?.note || '';
  if (note.includes('Khách vãng lai:')) {
    isWalkIn = true;
    const rawNote = note.replace('Khách vãng lai:', '').trim();
    const noteParts = rawNote.split(' - ');
    if (noteParts[0] && noteParts[0].trim()) {
      customerDisplayName = noteParts[0].trim();
    }
    if (noteParts[1] && noteParts[1].trim()) {
      customerDisplayPhone = noteParts[1].trim();
    }
  }

  return { customerDisplayName, customerDisplayPhone, isWalkIn };
}

exports.getAllSessions = async (req, res) => {
  try {
    const {
      search = '',
      status = '',
      courtId = '',
      date = '',
      page = 1,
      limit = 10
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    if (status && status !== 'ALL') {
      filter.status = status;
    }

    if (courtId && courtId !== 'ALL') {
      filter.courtId = courtId;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.checkInAt = { $gte: startOfDay, $lte: endOfDay };
    }

    if (search) {
      filter.$or = [
        { sessionCode: { $regex: search.trim(), $options: 'i' } },
        { note: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    const totalSessions = await PlayingSession.countDocuments(filter);
    const sessions = await PlayingSession.find(filter)
      .populate({
        path: 'bookingId',
        select: 'bookingCode bookingDate startTime endTime customerId price totalAmount note',
        populate: { path: 'customerId', select: 'fullName phone email' }
      })
      .populate('courtId', 'name status operationalStatus')
      .populate('staffId', 'fullName email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const mappedSessions = sessions.map((s) => {
      const { customerDisplayName, customerDisplayPhone, isWalkIn } = extractCustomerDisplayInfo(s.bookingId);
      return {
        ...s,
        customerDisplayName,
        customerDisplayPhone,
        isWalkIn
      };
    });

    return sendSuccess(res, {
      sessions: mappedSessions,
      pagination: {
        total: totalSessions,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalSessions / limitNum)
      }
    }, 'Lấy danh sách ca chơi thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.getCurrentLiveBoard = async (req, res) => {
  try {
    const courts = await Court.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean();

    const activeSessions = await PlayingSession.find({ status: 'IN_PROGRESS' })
      .populate({
        path: 'bookingId',
        select: 'bookingCode customerId startTime endTime totalAmount note',
        populate: { path: 'customerId', select: 'fullName phone' }
      })
      .populate('staffId', 'fullName')
      .lean();

    const now = new Date();

    const courtBoard = courts.map((court) => {
      const activeSession = activeSessions.find(
        (s) => s.courtId.toString() === court._id.toString()
      );

      let countdownSeconds = 0;
      let isNearEnd = false;
      let operationalStatus = activeSession ? 'IN_USE' : (court.operationalStatus === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE');

      if (!activeSession && court.operationalStatus === 'IN_USE') {
        Court.findByIdAndUpdate(court._id, { operationalStatus: 'AVAILABLE' }).catch(() => {});
      }

      if (activeSession) {
        operationalStatus = 'IN_USE';
        if (activeSession.scheduledEndTime) {
          const diffMs = new Date(activeSession.scheduledEndTime).getTime() - now.getTime();
          countdownSeconds = Math.max(0, Math.floor(diffMs / 1000));
          isNearEnd = activeSession.isNearEnd || (countdownSeconds <= 600 && countdownSeconds > 0);
        }

        const { customerDisplayName, customerDisplayPhone, isWalkIn } = extractCustomerDisplayInfo(activeSession.bookingId);
        activeSession.customerDisplayName = customerDisplayName;
        activeSession.customerDisplayPhone = customerDisplayPhone;
        activeSession.isWalkIn = isWalkIn;
      }

      return {
        ...court,
        operationalStatus,
        activeSession: activeSession ? {
          ...activeSession,
          countdownSeconds,
          isNearEnd
        } : null,
        currentSession: activeSession ? {
          ...activeSession,
          countdownSeconds,
          isNearEnd
        } : null
      };
    });

    return sendSuccess(res, courtBoard, 'Lấy dữ liệu giám sát sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.getSessionById = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await PlayingSession.findById(id)
      .populate({
        path: 'bookingId',
        populate: { path: 'customerId', select: 'fullName phone email' }
      })
      .populate('courtId', 'name status operationalStatus')
      .populate('staffId', 'fullName email')
      .populate('rentalItems.productId', 'name price')
      .lean();

    if (!session) {
      return sendError(res, 'Không tìm thấy thông tin ca chơi!', 404);
    }

    return sendSuccess(res, session, 'Lấy chi tiết ca chơi thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.checkInSession = async (req, res) => {
  try {
    const {
      bookingId,
      courtId,
      isWalkIn = false,
      walkInCustomerName = 'Khách vãng lai',
      walkInCustomerPhone = '',
      durationHours = 1,
      timeSlotId,
      acceptEarlyCheckIn = false,
      note = ''
    } = req.body;

    let playingDuration = Number(durationHours) || 1;
    const staffId = req.user?.userId;
    const now = new Date();
    const isEarlyAccepted = acceptEarlyCheckIn === true || acceptEarlyCheckIn === "true" || acceptEarlyCheckIn === 1 || acceptEarlyCheckIn === "1";

    let targetBooking = null;
    let targetCourt = null;
    let scheduledStartTime = now;
    let scheduledEndTime = new Date(now.getTime() + playingDuration * 60 * 60 * 1000);
    let baseCourtFee = 0;
    let earlyCheckInMinutes = 0;
    let earlyCheckInFee = 0;

    if (isWalkIn) {
      if (!courtId) {
        return sendError(res, 'Vui lòng chọn sân cho khách vãng lai!', 400);
      }
      targetCourt = await Court.findById(courtId);
      if (!targetCourt || targetCourt.status !== 'ACTIVE') {
        return sendError(res, 'Sân không hợp lệ hoặc đang dừng hoạt động!', 400);
      }

      const currentActiveSession = await PlayingSession.findOne({
        courtId: targetCourt._id,
        status: 'IN_PROGRESS'
      });
      if (currentActiveSession) {
        return sendError(res, 'Sân hiện tại đang có khách chơi. Vui lòng chọn sân khác!', 400);
      }


      let startHoursStr = req.body.startTime;
      let endHoursStr = req.body.endTime;

      if (!startHoursStr || !endHoursStr) {
        if (timeSlotId) {
          const slot = await TimeSlot.findById(timeSlotId);
          if (slot) {
            startHoursStr = slot.startTime;
            endHoursStr = slot.endTime;
          }
        }
      }

      if (!startHoursStr || !endHoursStr) {
        const curH = now.getHours();
        const curM = Math.floor(now.getMinutes() / 15) * 15;
        startHoursStr = String(curH).padStart(2, '0') + ':' + String(curM).padStart(2, '0');
        const endTotalMin = curH * 60 + curM + playingDuration * 60;
        const endH = Math.min(23, Math.floor(endTotalMin / 60));
        const endM = endTotalMin % 60;
        endHoursStr = String(endH).padStart(2, '0') + ':' + String(endM).padStart(2, '0');
      }

const [sh, sm] = startHoursStr.split(':').map(Number);
      const [eh, em] = endHoursStr.split(':').map(Number);
      const walkInTotalMinutes = (eh * 60 + em) - (sh * 60 + sm);

      if (walkInTotalMinutes < 60) {
        return sendError(res, 'Thời lượng chơi tối thiểu cho khách vãng lai phải từ 1 tiếng (60 phút) trở lên!', 400);
      }

      const nowTotalMin = now.getHours() * 60 + now.getMinutes();
      const startTotalMin = sh * 60 + sm;
      if (startTotalMin < nowTotalMin - 15) {
        return sendError(res, 'Không thể nhận khách vãng lai ở thời gian quá khứ!', 400);
      }
      if (startTotalMin > nowTotalMin + 30) {
        return sendError(res, 'Khách vãng lai chỉ nhận sân tại thời điểm hiện tại, không nhận thời gian tương lai!', 400);
      }

      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const conflictingBooking = await Booking.findOne({
        courtId: targetCourt._id,
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
        startTime: { $lt: endHoursStr },
        endTime: { $gt: startHoursStr }
      }).populate('customerId', 'fullName phone');

      if (conflictingBooking) {
        return sendError(
          res,
          `Sân ${targetCourt.name} trong khoảng ${startHoursStr} - ${endHoursStr} đã có lịch đặt của khách "${conflictingBooking.customerId?.fullName || 'khác'}" (${conflictingBooking.startTime} - ${conflictingBooking.endTime})!`,
          409
        );
      }

      baseCourtFee = await calculateIntervalPrice(targetCourt, startHoursStr, endHoursStr, now);
      playingDuration = Math.round((walkInTotalMinutes / 60) * 10) / 10;
      scheduledStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0, 0);
      scheduledEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0, 0);

      let customerUser = await Customer.findOne({ phone: walkInCustomerPhone });
      if (!customerUser) {
        customerUser = await Customer.create({
          fullName: walkInCustomerName || 'Khách vãng lai',
          phone: walkInCustomerPhone || '0900000000',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          password: 'WALK_IN_GUEST'
        });
      }

      const bookingCode = 'BK-VL-' + Date.now().toString().slice(-6);

      targetBooking = await Booking.create({
        customerId: customerUser._id,
        courtId: targetCourt._id,
        bookingCode,
        bookingDate: now,
        startTime: startHoursStr,
        endTime: endHoursStr,
        price: baseCourtFee,
        totalAmount: baseCourtFee,
        status: 'CHECKED_IN',
        note: `Khách vãng lai: ${walkInCustomerName} - ${walkInCustomerPhone || 'Không có SĐT'}`
      });
    } else {
      if (!bookingId) {
        return sendError(res, 'Vui lòng cung cấp mã đơn đặt sân!', 400);
      }

      targetBooking = await Booking.findById(bookingId).populate('courtId');
      if (!targetBooking) {
        return sendError(res, 'Không tìm thấy thông tin đơn đặt sân!', 404);
      }

      if (targetBooking.status !== 'CONFIRMED' && targetBooking.status !== 'CHECKED_IN') {
        return sendError(res, `Đơn đặt sân đang ở trạng thái "${targetBooking.status}", không thể nhận sân!`, 400);
      }

      if (courtId) {
        targetCourt = await Court.findById(courtId);
      }
      if (!targetCourt) {
        targetCourt = targetBooking.courtId;
      }
      if (!targetCourt || targetCourt.status !== 'ACTIVE') {
        return sendError(res, 'Sân được chỉ định hiện không hoạt động!', 400);
      }

      const occupyingSession = await PlayingSession.findOne({
        courtId: targetCourt._id,
        status: 'IN_PROGRESS'
      });
      if (occupyingSession) {
        return sendError(res, `Sân "${targetCourt.name}" hiện đang có người sử dụng. Vui lòng chờ hoặc đổi sân!`, 400);
      }

      const existingSessionForCourt = await PlayingSession.findOne({
        bookingId: targetBooking._id,
        courtId: targetCourt._id,
        status: { $in: ['IN_PROGRESS', 'COMPLETED'] }
      });
      if (existingSessionForCourt) {
        return sendError(res, `Sân "${targetCourt.name}" của đơn này đã được nhận sân trước đó rồi!`, 400);
      }

      const bookingDateStr = new Date(targetBooking.bookingDate).toISOString().split('T')[0];
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (bookingDateStr < todayStr) {
        return sendError(res, 'Đơn đặt sân thuộc ngày trong quá khứ, không thể nhận sân!', 400);
      }
      if (bookingDateStr > todayStr) {
        return sendError(res, 'Chưa đến ngày diễn ra đơn đặt sân, không thể nhận sân trước!', 400);
      }

      let matchedItem = null;
      if (Array.isArray(targetBooking.items) && targetBooking.items.length > 0) {
        matchedItem = targetBooking.items.find(
          (it) => it.courtId.toString() === targetCourt._id.toString() && it.status !== 'CANCELLED'
        );
      }

      const effectiveStartTime = matchedItem ? matchedItem.startTime : targetBooking.startTime;
      const effectiveEndTime = matchedItem ? matchedItem.endTime : targetBooking.endTime;

      const startParts = (effectiveStartTime || '07:00').split(':').map(Number);
      const endParts = (effectiveEndTime || '08:00').split(':').map(Number);
      const bookingStartTotalMin = startParts[0] * 60 + startParts[1];
      const bookingEndTotalMin = endParts[0] * 60 + endParts[1];
      const currentTotalMin = now.getHours() * 60 + now.getMinutes();

      if (currentTotalMin >= bookingEndTotalMin) {
        return sendError(res, `Đơn đặt sân ca (${effectiveStartTime} - ${effectiveEndTime}) đã kết thúc trong quá khứ! Không thể nhận sân.`, 400);
      }

      if (bookingStartTotalMin - currentTotalMin > 15) {
        if (!isEarlyAccepted) {
          return sendError(res, `Chưa đến thời gian nhận sân cho ca (${effectiveStartTime} - ${effectiveEndTime})! Khách đến sớm ${bookingStartTotalMin - currentTotalMin} phút. Vui lòng bật "Nhận sân sớm" nếu muốn nhận khách vào ngay.`, 400);
        }
        earlyCheckInMinutes = bookingStartTotalMin - currentTotalMin;
        const earlyStartStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        earlyCheckInFee = await calculateIntervalPrice(targetCourt, earlyStartStr, effectiveStartTime, now);
      }

      scheduledStartTime = earlyCheckInMinutes > 0 ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate(), startParts[0], startParts[1], 0, 0);
      scheduledEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endParts[0], endParts[1], 0, 0);
      baseCourtFee = matchedItem ? (matchedItem.price || 0) : (targetBooking.totalAmount || targetBooking.price || 0);
    }

    const sessionCode = 'SS-' + Date.now().toString().slice(-6);

    const newSession = await PlayingSession.create({
      sessionCode,
      bookingId: targetBooking._id,
      courtId: targetCourt._id,
      staffId: staffId || null,
      scheduledStartTime,
      scheduledEndTime,
      checkInAt: now,
      baseCourtFee,
      earlyCheckInMinutes,
      earlyCheckInFee,
      totalAmount: baseCourtFee + earlyCheckInFee,
      status: 'IN_PROGRESS',
      isNearEnd: false,
      note
    });

    targetBooking.status = 'CHECKED_IN';
    await targetBooking.save();

    targetCourt.operationalStatus = 'IN_USE';
    await targetCourt.save();

    scheduleSessionNearEndWarning(newSession, targetCourt.name);

    const populatedSession = await PlayingSession.findById(newSession._id)
      .populate('bookingId')
      .populate('courtId')
      .populate('staffId', 'fullName')
      .lean();

    return sendSuccess(res, populatedSession, 'Bắt đầu ca chơi thành công!', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.extendSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { extensionMinutes } = req.body;

    const minutes = parseInt(extensionMinutes, 10);
    if (![30, 60].includes(minutes)) {
      return sendError(res, 'Thời gian gia hạn phải là 30 phút hoặc 60 phút!', 400);
    }

    const session = await PlayingSession.findById(id).populate('courtId').populate({
      path: 'bookingId',
      populate: { path: 'customerId', select: 'fullName phone email' }
    });
    if (!session || session.status !== 'IN_PROGRESS') {
      return sendError(res, 'Ca chơi không tồn tại hoặc đã kết thúc!', 400);
    }

    const now = new Date();
    const currentEndTime = new Date(session.scheduledEndTime);
    if (currentEndTime.getTime() <= now.getTime()) {
      return sendError(
        res,
        'Ca chơi đã hết giờ trong quá khứ, không thể gia hạn thêm! Vui lòng thực hiện Trả sân & Xuất hóa đơn để thanh toán.',
        400
      );
    }

    const newEndTime = new Date(currentEndTime.getTime() + minutes * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toVNTimeStr = (d) => {
      const vnDate = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
      return `${pad(vnDate.getHours())}:${pad(vnDate.getMinutes())}`;
    };

    const currentEndHoursStr = toVNTimeStr(currentEndTime);
    const newEndHoursStr = toVNTimeStr(newEndTime);

    const vnDate = new Date(currentEndTime.getTime() + (7 * 60 + currentEndTime.getTimezoneOffset()) * 60000);
    const y = vnDate.getFullYear();
    const m = vnDate.getMonth();
    const d = vnDate.getDate();
    const minDate = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
    const maxDate = new Date(Date.UTC(y, m, d + 1, 23, 59, 59, 999));

    const currentCourtId = session.courtId?._id || session.courtId;
    const currentBookingId = session.bookingId?._id || session.bookingId;

    const conflictingBooking = await Booking.findOne({
      courtId: currentCourtId,
      _id: { $ne: currentBookingId },
      status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      bookingDate: { $gte: minDate, $lte: maxDate },
      startTime: { $lt: newEndHoursStr },
      endTime: { $gt: currentEndHoursStr }
    }).populate('customerId', 'fullName phone');

    if (conflictingBooking) {
      const custName = conflictingBooking.customerId?.fullName || conflictingBooking.customerDisplayName || 'khách khác';
      return sendError(
        res,
        `Không thể gia hạn: Sân đã có ca tiếp theo của khách "${custName}" (${conflictingBooking.startTime} - ${conflictingBooking.endTime}). Không được gia hạn qua giờ của ca sau!`,
        409
      );
    }

    const conflictingSession = await PlayingSession.findOne({
      courtId: currentCourtId,
      _id: { $ne: session._id },
      status: 'IN_PROGRESS',
      scheduledStartTime: { $lt: newEndTime },
      scheduledEndTime: { $gt: currentEndTime }
    });

    if (conflictingSession) {
      return sendError(
        res,
        'Không thể gia hạn: Sân đã có ca chơi khác đang diễn ra trong khung giờ này!',
        409
      );
    }

    const extensionFee = await calculateIntervalPrice(session.courtId, currentEndHoursStr, newEndHoursStr, currentEndTime);

    session.scheduledEndTime = newEndTime;
    session.extensions.push({
      extendedMinutes: minutes,
      extendedFee: extensionFee,
      extendedAt: new Date()
    });
    session.totalAmount += extensionFee;
    session.isNearEnd = false;

    await session.save();

    if (session.bookingId) {
      const updateDoc = { endTime: newEndHoursStr };
      const bk = await Booking.findById(currentBookingId);
      if (bk && Array.isArray(bk.items) && bk.items.length > 0) {
        updateDoc['items.$[].endTime'] = newEndHoursStr;
      }
      await Booking.findByIdAndUpdate(currentBookingId, updateDoc);
    }

    scheduleSessionNearEndWarning(session, session.courtId.name);

    return sendSuccess(res, session, `Gia hạn ca chơi thành công thêm ${minutes} phút!`, 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.switchCourt = async (req, res) => {
  try {
    const { id } = req.params;
    const { newCourtId, reason = '' } = req.body;

    if (!newCourtId) {
      return sendError(res, 'Vui lòng chọn sân mới để chuyển!', 400);
    }

    const session = await PlayingSession.findById(id).populate('courtId');
    if (!session || session.status !== 'IN_PROGRESS') {
      return sendError(res, 'Ca chơi không tồn tại hoặc đã kết thúc!', 400);
    }

    const oldCourtId = session.courtId?._id || session.courtId;
    const currentCourt = await Court.findById(oldCourtId);
    const newCourt = await Court.findById(newCourtId);
    if (!newCourt || newCourt.status !== 'ACTIVE') {
      return sendError(res, 'Sân mới không hợp lệ hoặc đang dừng hoạt động!', 400);
    }

    if (newCourt._id.toString() === oldCourtId.toString()) {
      return sendError(res, 'Sân mới phải khác với sân hiện tại!', 400);
    }

    const currentNorm = normalizeCourtType(currentCourt?.courtType);
    const newNorm = normalizeCourtType(newCourt?.courtType);
    if (currentNorm !== newNorm) {
      return sendError(
        res,
        `Chỉ được phép đổi sang sân cùng loại (${getCourtTypeName(currentNorm)})! Sân ${newCourt.name} thuộc phân khúc ${getCourtTypeName(newNorm)}.`,
        400
      );
    }

    const isNewCourtBusy = await PlayingSession.findOne({
      courtId: newCourt._id,
      _id: { $ne: session._id },
      status: 'IN_PROGRESS'
    });
    if (isNewCourtBusy) {
      return sendError(res, `Sân mới (${newCourt.name}) hiện đang có người chơi!`, 400);
    }

    if (session.scheduledEndTime) {
      const pad = (n) => String(n).padStart(2, '0');
      const toVNTimeStr = (d) => {
        const vnDate = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
        return `${pad(vnDate.getHours())}:${pad(vnDate.getMinutes())}`;
      };

      const now = new Date();
      const nowHoursStr = toVNTimeStr(now);
      const scheduledEnd = new Date(session.scheduledEndTime);
      const endHoursStr = toVNTimeStr(scheduledEnd);

      const vnDate = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
      const y = vnDate.getFullYear();
      const m = vnDate.getMonth();
      const d = vnDate.getDate();
      const minDate = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
      const maxDate = new Date(Date.UTC(y, m, d + 1, 23, 59, 59, 999));

      const conflictingBooking = await Booking.findOne({
        courtId: newCourt._id,
        _id: { $ne: session.bookingId?._id || session.bookingId },
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        bookingDate: {
          $gte: minDate,
          $lte: maxDate
        },
        startTime: { $lt: endHoursStr },
        endTime: { $gt: nowHoursStr }
      }).populate('customerId', 'fullName phone');

      if (conflictingBooking) {
        const custName = conflictingBooking.customerId?.fullName || conflictingBooking.customerDisplayName || 'khách khác';
        return sendError(
          res,
          `Không thể đổi sang ${newCourt.name}: Sân này đã có lịch đặt của khách "${custName}" (${conflictingBooking.startTime} - ${conflictingBooking.endTime}) trùng với thời gian chơi của ca này!`,
          400
        );
      }

      const conflictingSession = await PlayingSession.findOne({
        courtId: newCourt._id,
        _id: { $ne: session._id },
        status: 'IN_PROGRESS',
        scheduledStartTime: { $lt: scheduledEnd },
        scheduledEndTime: { $gt: now }
      });

      if (conflictingSession) {
        return sendError(
          res,
          `Không thể đổi sang ${newCourt.name}: Sân này đang có ca chơi khác (${conflictingSession.sessionCode}) diễn ra trong khung giờ này!`,
          400
        );
      }
    }

    session.courtId = newCourt._id;
    session.note = (session.note || '') + ` [Đã chuyển từ sân ${currentCourt?.name || 'cũ'} sang sân ${newCourt.name}. Lý do: ${reason}]`;
    await session.save();

    if (session.bookingId) {
      await Booking.findByIdAndUpdate(session.bookingId?._id || session.bookingId, {
        courtId: newCourt._id
      });
    }

    await Court.findByIdAndUpdate(oldCourtId, { operationalStatus: 'AVAILABLE' });
    await Court.findByIdAndUpdate(newCourt._id, { operationalStatus: 'IN_USE' });

    scheduleSessionNearEndWarning(session, newCourt.name);

    return sendSuccess(res, session, `Chuyển ca chơi sang sân ${newCourt.name} thành công!`, 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.checkOutSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { rentalDamages = [], note = '' } = req.body;

    const session = await PlayingSession.findById(id).populate('courtId').populate({
      path: 'bookingId',
      populate: { path: 'customerId', select: 'fullName phone email' }
    });
    if (!session) {
      return sendError(res, 'Không tìm thấy ca chơi!', 404);
    }

    if (session.status === 'COMPLETED') {
      return sendError(res, 'Ca chơi này đã kết thúc trước đó!', 400);
    }

    const now = new Date();
    session.checkOutAt = now;

    let totalDamageFee = 0;
    if (rentalDamages.length > 0) {
      session.rentalItems.forEach((item) => {
        const damageReport = rentalDamages.find((d) => d.rentalItemId === item._id.toString());
        if (damageReport) {
          item.damaged = true;
          item.compensationFee = Number(damageReport.compensationFee) || 0;
          totalDamageFee += item.compensationFee;
        } else {
          item.returned = true;
        }
      });
    }

    session.overtimeMinutes = 0;
    session.overtimeFee = 0;

    const totalRentalItemFee = session.rentalItems.reduce(
      (sum, item) => sum + (item.unitPrice * item.quantity) + (item.compensationFee || 0),
      0
    );

    const totalExtensionsFee = session.extensions.reduce(
      (sum, ext) => sum + (ext.extendedFee || 0),
      0
    );

    session.totalAmount = session.baseCourtFee + session.earlyCheckInFee + totalExtensionsFee + totalRentalItemFee;
    session.status = 'COMPLETED';
    session.actualDuration = session.scheduledStartTime ? Math.round((now - session.scheduledStartTime) / (60 * 1000)) : 60;
    if (note) session.note = (session.note ? session.note + ' | ' : '') + note;

    await session.save();

    cancelSessionWarning(session._id);

    if (session.bookingId) {
      const bDoc = await Booking.findById(session.bookingId._id || session.bookingId);
      if (bDoc) {
        if (Array.isArray(bDoc.items) && bDoc.items.length > 1) {
          const completedSessionsCount = await PlayingSession.countDocuments({
            bookingId: bDoc._id,
            status: 'COMPLETED'
          });
          const activeItemsCount = bDoc.items.filter((it) => it.status !== 'CANCELLED').length;
          if (completedSessionsCount >= activeItemsCount) {
            bDoc.status = 'COMPLETED';
            await bDoc.save();
          }
        } else {
          bDoc.status = 'COMPLETED';
          await bDoc.save();
        }
      }
    }

    if (session.courtId) {
      await Court.findByIdAndUpdate(session.courtId._id, { operationalStatus: 'AVAILABLE' });
    }

    const { customerDisplayName, customerDisplayPhone } = extractCustomerDisplayInfo(session.bookingId);
    const invoiceCode = 'HD-' + Date.now().toString().slice(-6);
    const isPrepaid = session.bookingId?.paymentStatus === 'PAID';
    const prepaidDeposit = isPrepaid ? (session.bookingId.totalAmount || session.baseCourtFee || 0) : 0;
    const finalInvoiceTotal = Math.max(0, session.totalAmount - prepaidDeposit);

    const invoice = await Invoice.create({
      playingSessionId: session._id,
      staffId: req.user?.userId || session.staffId,
      invoiceCode,
      orderType: 'PLAYING_SESSION',
      items: session.rentalItems.map((item) => ({
        productId: item.productId || null,
        productName: item.productName || 'Sản phẩm/dịch vụ',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        subtotal: (item.unitPrice || 0) * (item.quantity || 1)
      })),
      customer: {
        customerId: session.bookingId?.customerId?._id || null,
        fullName: customerDisplayName,
        phone: customerDisplayPhone
      },
      sessionDetails: {
        courtName: session.courtId?.name || '',
        scheduledDurationHours: session.actualDuration ? Math.round((session.actualDuration / 60) * 10) / 10 : 1,
        baseCourtFee: session.baseCourtFee || 0,
        earlyCheckInFee: session.earlyCheckInFee || 0,
        overtimeFee: 0,
        rentalDamageFee: totalDamageFee,
        extensionFee: totalExtensionsFee,
        consumableFee: totalRentalItemFee - totalDamageFee,
        prepaidDeposit
      },
      subtotal: session.totalAmount,
      discountAmount: prepaidDeposit,
      totalAmount: finalInvoiceTotal,
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID',
      status: 'ACTIVE'
    });

    return sendSuccess(res, {
      session,
      invoice,
      overtimeAlert: null
    }, 'Kết thúc ca chơi thành công! Đã tạo hóa đơn thanh toán tại quầy.', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.completeCleaning = async (req, res) => {
  try {
    const { courtId } = req.params;
    const court = await Court.findById(courtId);
    if (!court) {
      return sendError(res, 'Không tìm thấy sân!', 404);
    }

    court.operationalStatus = 'AVAILABLE';
    await court.save();

    return sendSuccess(res, court, `Sân ${court.name} đã dọn dẹp xong và sẵn sàng nhận khách!`, 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.addRentalItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { productId, productName, quantity = 1, unitPrice, items } = req.body;

    const session = await PlayingSession.findById(id).populate('courtId');
    if (!session || session.status !== 'IN_PROGRESS') {
      return sendError(res, 'Ca chơi không tồn tại hoặc đã kết thúc!', 400);
    }

    const itemsToAdd = (items && Array.isArray(items) && items.length > 0)
      ? items
      : [{ productId, productName, quantity, unitPrice }];

    let addedTotal = 0;
    for (const it of itemsToAdd) {
      const qty = parseInt(it.quantity, 10) || 1;
      let itemPrice = Number(it.unitPrice || it.price);
      let itemName = it.productName || it.name;
      let prodId = it.productId || null;

      if (prodId) {
        const product = await Product.findById(prodId);
        if (!product || product.status !== 'ACTIVE') {
          return sendError(res, `Sản phẩm "${itemName || prodId}" không tồn tại hoặc đã ngừng kinh doanh!`, 400);
        }
        if (product.stockQuantity < qty) {
          return sendError(res, `Sản phẩm "${product.name}" chỉ còn ${product.stockQuantity} trong kho!`, 400);
        }
        product.stockQuantity -= qty;
        await product.save();
        itemPrice = product.price;
        itemName = product.name;
      }

      if (!itemName || isNaN(itemPrice)) {
        return sendError(res, 'Vui lòng cung cấp tên sản phẩm và đơn giá hợp lệ!', 400);
      }

      session.rentalItems.push({
        productId: prodId,
        productName: itemName,
        quantity: qty,
        unitPrice: itemPrice,
        returned: false
      });

      addedTotal += itemPrice * qty;
    }

    session.totalAmount += addedTotal;
    await session.save();

    return sendSuccess(res, session, `Đã ghi nhận ${itemsToAdd.length} mặt hàng vào ca chơi thành công!`, 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.getCourtMatrix = async (req, res) => {
  try {
    const { date } = req.query;

    let targetDateStr = date;
    if (!targetDateStr) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      targetDateStr = `${y}-${m}-${d}`;
    }

    const courts = await Court.find({ status: 'ACTIVE' }).sort({ name: 1 }).lean();
    
    const stepMin = 15;
    const startHour = 6;
    const endHour = 23;
    const timeSlots = [];
    let curMin = startHour * 60;
    const maxMin = endHour * 60;
    let slotIdx = 1;
    while (curMin < maxMin) {
      const nextMin = Math.min(maxMin, curMin + stepMin);
      const sh = String(Math.floor(curMin / 60)).padStart(2, '0');
      const sm = String(curMin % 60).padStart(2, '0');
      const eh = String(Math.floor(nextMin / 60)).padStart(2, '0');
      const em = String(nextMin % 60).padStart(2, '0');
      timeSlots.push({
        _id: `slot_${sh}${sm}_${eh}${em}`,
        startTime: `${sh}:${sm}`,
        endTime: `${eh}:${em}`,
        label: `${sh}:${sm} - ${eh}:${em}`,
        slotOrder: slotIdx
      });
      curMin = nextMin;
      slotIdx++;
    }

    const [year, month, day] = targetDateStr.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    const utcStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const utcEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const minDate = new Date(Math.min(startOfDay.getTime(), utcStart.getTime()));
    const maxDate = new Date(Math.max(endOfDay.getTime(), utcEnd.getTime()));

    try {
      await autoCancelLateBookings();
    } catch (e) {
      console.error('[getCourtMatrix] Error running autoCancelLateBookings:', e.message);
    }

    const bookings = await Booking.find({
      bookingDate: { $gte: minDate, $lte: maxDate },
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
    })
      .populate('customerId', 'fullName phone email')
      .lean();

    const sessions = await PlayingSession.find({
      checkInAt: { $gte: minDate, $lte: maxDate },
      status: { $in: ['IN_PROGRESS', 'COMPLETED', 'WAITING'] }
    })
      .populate('staffId', 'fullName')
      .populate({
        path: 'bookingId',
        select: 'bookingCode note customerId',
        populate: { path: 'customerId', select: 'fullName phone' }
      })
      .lean();

    const activeLiveSessions = await PlayingSession.find({
      status: 'IN_PROGRESS'
    })
      .populate({
        path: 'bookingId',
        select: 'bookingCode note customerId courtId',
        populate: { path: 'customerId', select: 'fullName phone' }
      })
      .lean();

    await Promise.all(
      activeLiveSessions.map(async (s) => {
        if (s.bookingId && s.courtId && s.bookingId.courtId?.toString() !== s.courtId.toString()) {
          if (!s.bookingId.items || s.bookingId.items.length <= 1) {
            await Booking.findByIdAndUpdate(s.bookingId._id, { courtId: s.courtId });
          }
        }
      })
    );

    const allCourtSessions = [...sessions];
    activeLiveSessions.forEach((als) => {
      if (!allCourtSessions.some((s) => s._id.toString() === als._id.toString())) {
        allCourtSessions.push(als);
      }
    });

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentMinutesOfDay = currentHours * 60 + currentMinutes;

    const todayObj = new Date();
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
    const isCurrentDate = targetDateStr === todayStr;

    // Chuẩn bị danh sách slot của các đơn đặt sân (hỗ trợ đơn đặt nhiều sân / nhiều items)
    const bookingSlots = [];
    bookings.forEach((b) => {
      const bInfo = extractCustomerDisplayInfo(b);
      if (Array.isArray(b.items) && b.items.length > 0) {
        b.items.forEach((item) => {
          if (item.status === 'CANCELLED') return;
          bookingSlots.push({
            booking: b,
            _id: b._id,
            bookingCode: b.bookingCode,
            courtId: item.courtId?._id || item.courtId,
            startTime: item.startTime,
            endTime: item.endTime,
            status: b.status,
            paymentStatus: b.paymentStatus,
            totalAmount: item.price || b.totalAmount,
            itemId: item._id,
            note: b.note,
            customerDisplayName: bInfo.customerDisplayName,
            customerDisplayPhone: bInfo.customerDisplayPhone,
            isWalkIn: bInfo.isWalkIn,
            customerId: b.customerId
          });
        });
      } else {
        bookingSlots.push({
          booking: b,
          _id: b._id,
          bookingCode: b.bookingCode,
          courtId: b.courtId?._id || b.courtId,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          paymentStatus: b.paymentStatus,
          totalAmount: b.totalAmount,
          itemId: null,
          note: b.note,
          customerDisplayName: bInfo.customerDisplayName,
          customerDisplayPhone: bInfo.customerDisplayPhone,
          isWalkIn: bInfo.isWalkIn,
          customerId: b.customerId
        });
      }
    });

    const matrix = {};

    courts.forEach((court) => {
      matrix[court._id] = timeSlots.map((slot) => {
        const [slotStartH, slotStartM] = slot.startTime.split(':').map(Number);
        const [slotEndH, slotEndM] = slot.endTime.split(':').map(Number);
        const slotStartTotalMin = slotStartH * 60 + slotStartM;
        const slotEndTotalMin = slotEndH * 60 + slotEndM;

        let matchedSlot = bookingSlots.find((bSlot) => {
          if (!bSlot.courtId || bSlot.courtId.toString() !== court._id.toString()) return false;
          if (!bSlot.startTime || !bSlot.endTime) return false;
          const [bsh, bsm] = bSlot.startTime.split(':').map(Number);
          const [beh, bem] = bSlot.endTime.split(':').map(Number);
          const bStartMin = bsh * 60 + bsm;
          const bEndMin = beh * 60 + bem;

          const overlap = Math.min(bEndMin, slotEndTotalMin) - Math.max(bStartMin, slotStartTotalMin);
          return overlap >= Math.min(stepMin, 15);
        });

        let matchedBooking = matchedSlot ? matchedSlot.booking : null;

        if (matchedBooking) {
          const movedSession = activeLiveSessions.find(
            (s) => s.bookingId && s.bookingId._id?.toString() === matchedBooking._id.toString() && s.courtId?.toString() !== court._id.toString()
          );
          if (movedSession && (!matchedBooking.items || matchedBooking.items.length <= 1)) {
            matchedBooking = null;
            matchedSlot = null;
          }
        }

        let matchedSession = allCourtSessions.find((s) => {
          if (!s.courtId) return false;
          const sCourtId = (s.courtId._id || s.courtId).toString();
          if (sCourtId !== court._id.toString()) return false;
          if (s.status === 'CANCELLED') return false;

          let sStartMin = 0;
          let sEndMin = 0;
          if (s.scheduledStartTime && s.scheduledEndTime) {
            const startD = new Date(s.scheduledStartTime);
            const endD = new Date(s.scheduledEndTime);
            sStartMin = startD.getHours() * 60 + startD.getMinutes();
            sEndMin = endD.getHours() * 60 + endD.getMinutes();
          } else if (s.bookingId?.startTime && s.bookingId?.endTime) {
            const [sh, sm] = s.bookingId.startTime.split(':').map(Number);
            const [eh, em] = s.bookingId.endTime.split(':').map(Number);
            sStartMin = sh * 60 + sm;
            sEndMin = eh * 60 + em;
          }
          if (sEndMin <= sStartMin) sEndMin = sStartMin + 60;
          const overlap = Math.min(sEndMin, slotEndTotalMin) - Math.max(sStartMin, slotStartTotalMin);
          return overlap >= Math.min(stepMin, 15);
        });

        if (matchedSession && !matchedBooking && matchedSession.bookingId) {
          matchedBooking = matchedSession.bookingId;
        }

        if (matchedBooking && !matchedSession) {
          const movedSession = allCourtSessions.find(
            (s) => s.bookingId && s.bookingId._id?.toString() === matchedBooking._id.toString() && (s.courtId?._id || s.courtId)?.toString() !== court._id.toString()
          );
          if (movedSession && (!matchedBooking.items || matchedBooking.items.length <= 1)) {
            matchedBooking = null;
            matchedSlot = null;
          }
        }

        let cellStatus = 'AVAILABLE';
        let isLate = false;
        let lateMinutes = 0;

        if (matchedSession && matchedSession.status === 'IN_PROGRESS') {
          cellStatus = 'IN_PROGRESS';
        } else if (matchedSession && matchedSession.status === 'COMPLETED') {
          cellStatus = 'COMPLETED';
        } else if (matchedSlot) {
          if (matchedBooking.status === 'COMPLETED') {
            cellStatus = 'COMPLETED';
          } else {
            cellStatus = 'CONFIRMED';
            if (isCurrentDate && currentMinutesOfDay > slotStartTotalMin) {
              lateMinutes = currentMinutesOfDay - slotStartTotalMin;
              if (lateMinutes > 15) {
                // Khách đến trễ quá 15 phút -> Tự động hủy đơn và giải phóng sân thành AVAILABLE
                isLate = false;
                cellStatus = 'AVAILABLE';
                const bookingToCancelId = matchedBooking?._id || matchedSlot?._id;
                if (bookingToCancelId) {
                  Booking.updateOne(
                    { _id: bookingToCancelId, status: 'CONFIRMED' },
                    {
                      $set: {
                        status: 'CANCELLED',
                        cancellationReason: 'Tự động hủy do khách đến trễ quá 15 phút so với giờ bắt đầu'
                      },
                      $push: {
                        cancellationHistory: {
                          cancelledAt: now,
                          cancelledByRole: 'STAFF',
                          previousStatus: 'CONFIRMED',
                          scope: 'BOOKING'
                        }
                      }
                    }
                  ).catch((err) => console.error('[getCourtMatrix auto-cancel error]:', err.message));
                }
                matchedSlot = null;
                matchedBooking = null;
              } else {
                isLate = true;
              }
            }
          }
        }

        const displayCustomerName = matchedSlot
          ? matchedSlot.customerDisplayName
          : (matchedBooking ? extractCustomerDisplayInfo(matchedBooking).customerDisplayName : 'Khách vãng lai');
        const displayCustomerPhone = matchedSlot
          ? matchedSlot.customerDisplayPhone
          : (matchedBooking ? extractCustomerDisplayInfo(matchedBooking).customerDisplayPhone : '');
        const isWalkIn = matchedSlot
          ? matchedSlot.isWalkIn
          : (matchedBooking ? extractCustomerDisplayInfo(matchedBooking).isWalkIn : false);

        return {
          courtId: court._id,
          timeSlotId: slot._id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: slot.label || `${slot.startTime} - ${slot.endTime}`,
          status: cellStatus,
          isLate,
          lateMinutes,
          booking: matchedSlot
            ? {
                _id: matchedSlot._id,
                bookingCode: matchedSlot.bookingCode,
                status: cellStatus,
                bookingStatus: matchedBooking.status,
                paymentStatus: matchedSlot.paymentStatus,
                totalAmount: matchedSlot.totalAmount,
                startTime: matchedSlot.startTime,
                endTime: matchedSlot.endTime,
                itemId: matchedSlot.itemId,
                courtId: court._id,
                customer: {
                  fullName: displayCustomerName,
                  phone: displayCustomerPhone,
                  email: matchedBooking?.customerId?.email || ''
                },
                customerDisplayName: displayCustomerName,
                customerDisplayPhone: displayCustomerPhone,
                isWalkIn,
                note: matchedSlot.note
              }
            : (matchedBooking
                ? {
                    _id: matchedBooking._id,
                    bookingCode: matchedBooking.bookingCode,
                    status: cellStatus,
                    bookingStatus: matchedBooking.status,
                    paymentStatus: matchedBooking.paymentStatus,
                    totalAmount: matchedBooking.totalAmount,
                    startTime: matchedBooking.startTime,
                    endTime: matchedBooking.endTime,
                    itemId: null,
                    courtId: court._id,
                    customer: {
                      fullName: displayCustomerName,
                      phone: displayCustomerPhone,
                      email: matchedBooking?.customerId?.email || ''
                    },
                    customerDisplayName: displayCustomerName,
                    customerDisplayPhone: displayCustomerPhone,
                    isWalkIn,
                    note: matchedBooking.note
                  }
                : null),
          session: matchedSession
            ? {
                _id: matchedSession._id,
                courtId: {
                  _id: court._id,
                  name: court.name,
                  courtType: court.courtType
                },
                courtName: court.name,
                bookingId: matchedSession.bookingId?._id || matchedSession.bookingId,
                sessionCode: matchedSession.sessionCode,
                status: matchedSession.status,
                baseCourtFee: matchedSession.baseCourtFee || 0,
                earlyCheckInFee: matchedSession.earlyCheckInFee || 0,
                extensions: matchedSession.extensions || [],
                scheduledStartTime: matchedSession.scheduledStartTime,
                scheduledEndTime: matchedSession.scheduledEndTime,
                isNearEnd: matchedSession.isNearEnd,
                customerDisplayName: displayCustomerName,
                customerDisplayPhone: displayCustomerPhone,
                isWalkIn
              }
            : null
        };
      });
    });

    const dayBookings = [];
    bookings.forEach((b) => {
      const bInfo = extractCustomerDisplayInfo(b);
      if (Array.isArray(b.items) && b.items.length > 0) {
        b.items.forEach((item) => {
          if (item.status === 'CANCELLED') return;
          dayBookings.push({
            _id: b._id,
            bookingCode: b.bookingCode,
            courtId: item.courtId?._id || item.courtId,
            startTime: item.startTime,
            endTime: item.endTime,
            status: b.status,
            totalAmount: item.price || b.totalAmount,
            paymentStatus: b.paymentStatus,
            customerName: bInfo.customerDisplayName,
            customerPhone: bInfo.customerDisplayPhone,
            isWalkIn: bInfo.isWalkIn,
            note: b.note,
            itemId: item._id
          });
        });
      } else {
        dayBookings.push({
          _id: b._id,
          bookingCode: b.bookingCode,
          courtId: b.courtId,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          totalAmount: b.totalAmount,
          paymentStatus: b.paymentStatus,
          customerName: bInfo.customerDisplayName,
          customerPhone: bInfo.customerDisplayPhone,
          isWalkIn: bInfo.isWalkIn,
          note: b.note,
          itemId: null
        });
      }
    });

    return sendSuccess(
      res,
      {
        date: targetDateStr,
        courts,
        timeSlots,
        matrix,
        bookings: dayBookings
      },
      'Lấy sơ đồ ma trận lịch sân thành công!',
      200
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

