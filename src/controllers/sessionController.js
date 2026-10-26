const PlayingSession = require('../models/playingSession');
const Booking = require('../models/booking');
const Court = require('../models/court');
const User = require('../models/user');
const TimeSlot = require('../models/timeSlot');
const Price = require('../models/price');
const PriceRule = require('../models/priceRule');
const Invoice = require('../models/invoice');
const Product = require('../models/product');
const Notification = require('../models/notification');
const { sendSuccess, sendError } = require('../utils/response');
const {
  scheduleSessionNearEndWarning,
  cancelSessionWarning,
  scheduleAutoCleanFinish
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
      let operationalStatus = court.operationalStatus || 'AVAILABLE';

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

      if (!timeSlotId) {
        return sendError(res, 'Vui lòng chọn khung giờ cho ca đấu!', 400);
      }

      const slot = await TimeSlot.findById(timeSlotId);
      if (!slot) {
        return sendError(res, 'Khung giờ không hợp lệ!', 400);
      }

      startTime = slot.startTime;
      endTime = slot.endTime;
      const hourlyRate = await getHourlyRate(targetCourt, now, startTime);

      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const slotTotalMinutes = eh * 60 + em - (sh * 60 + sm);
      const slotStartTotalMin = sh * 60 + sm;
      const slotEndTotalMin = eh * 60 + em;
      const currentTotalMin = now.getHours() * 60 + now.getMinutes();

      if (currentTotalMin >= slotEndTotalMin) {
        return sendError(res, `Ca đấu (${slot.startTime} - ${slot.endTime}) đã kết thúc trong quá khứ! Không thể nhận sân.`, 400);
      }

      if (slotStartTotalMin - currentTotalMin > 15) {
        return sendError(res, `Chưa đến thời gian nhận sân cho ca đấu này (${slot.startTime} - ${slot.endTime})! Chỉ mở nhận sân trước giờ bắt đầu tối đa 15 phút.`, 400);
      }

      if (currentTotalMin >= slotStartTotalMin && currentTotalMin < slotEndTotalMin) {
        const remainingMinutes = slotEndTotalMin - currentTotalMin;
        const billedMinutes = Math.max(30, remainingMinutes);
        playingDuration = Math.round((billedMinutes / 60) * 100) / 100;
        scheduledStartTime = now;
        scheduledEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0, 0);
        baseCourtFee = Math.round((hourlyRate / 60) * billedMinutes);
      } else {
        const slotHours = slotTotalMinutes > 0 ? slotTotalMinutes / 60 : 1;
        playingDuration = slotHours;
        scheduledStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0, 0);
        scheduledEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0, 0);
        baseCourtFee = hourlyRate * playingDuration;
      }

      let customerUser = await User.findOne({ phone: walkInCustomerPhone });
      if (!customerUser) {
        customerUser = await User.findOne({ role: 'ADMIN' });
      }

      const bookingCode = 'BK-VL-' + Date.now().toString().slice(-6);

      targetBooking = await Booking.create({
        customerId: customerUser._id,
        courtId: targetCourt._id,
        bookingCode,
        bookingDate: now,
        startTime,
        endTime,
        price: baseCourtFee,
        totalAmount: baseCourtFee,
        status: 'CHECKED_IN',
        note: `Khách vãng lai: ${walkInCustomerName} - ${walkInCustomerPhone}`
      });
    } else {
      if (!bookingId) {
        return sendError(res, 'Vui lòng cung cấp mã đơn đặt sân!', 400);
      }

      targetBooking = await Booking.findById(bookingId).populate('courtId');
      if (!targetBooking) {
        return sendError(res, 'Không tìm thấy thông tin đơn đặt sân!', 404);
      }

      if (targetBooking.status !== 'CONFIRMED') {
        return sendError(res, `Đơn đặt sân đang ở trạng thái "${targetBooking.status}", không thể nhận sân!`, 400);
      }

      targetCourt = targetBooking.courtId;
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

      const bookingDateStr = new Date(targetBooking.bookingDate).toISOString().split('T')[0];
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (bookingDateStr < todayStr) {
        return sendError(res, 'Đơn đặt sân thuộc ngày trong quá khứ, không thể nhận sân!', 400);
      }
      if (bookingDateStr > todayStr) {
        return sendError(res, 'Chưa đến ngày diễn ra đơn đặt sân, không thể nhận sân trước!', 400);
      }

      const startParts = (targetBooking.startTime || '07:00').split(':').map(Number);
      const endParts = (targetBooking.endTime || '08:00').split(':').map(Number);
      const bookingStartTotalMin = startParts[0] * 60 + startParts[1];
      const bookingEndTotalMin = endParts[0] * 60 + endParts[1];
      const currentTotalMin = now.getHours() * 60 + now.getMinutes();

      if (currentTotalMin >= bookingEndTotalMin) {
        return sendError(res, `Đơn đặt sân ca (${targetBooking.startTime} - ${targetBooking.endTime}) đã kết thúc trong quá khứ! Không thể nhận sân.`, 400);
      }

      if (bookingStartTotalMin - currentTotalMin > 15) {
        return sendError(res, `Chưa đến thời gian nhận sân cho ca (${targetBooking.startTime} - ${targetBooking.endTime})! Chỉ được nhận sân trước giờ bắt đầu tối đa 15 phút.`, 400);
      }

      scheduledStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startParts[0], startParts[1], 0, 0);
      scheduledEndTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endParts[0], endParts[1], 0, 0);
      baseCourtFee = targetBooking.totalAmount || targetBooking.price || 0;
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

    const currentEndTime = new Date(session.scheduledEndTime);
    const newEndTime = new Date(currentEndTime.getTime() + minutes * 60 * 1000);

    const bookingDateStr = currentEndTime.toISOString().split('T')[0];
    const newEndHoursStr = String(newEndTime.getHours()).padStart(2, '0') + ':' + String(newEndTime.getMinutes()).padStart(2, '0');

    const conflictingBooking = await Booking.findOne({
      courtId: session.courtId._id,
      _id: { $ne: session.bookingId },
      status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      bookingDate: {
        $gte: new Date(bookingDateStr + 'T00:00:00.000Z'),
        $lte: new Date(bookingDateStr + 'T23:59:59.999Z')
      },
      startTime: { $lt: newEndHoursStr }
    }).populate('customerId', 'fullName phone');

    if (conflictingBooking) {
      const activeCourts = await Court.find({
        status: 'ACTIVE',
        _id: { $ne: session.courtId._id }
      }).lean();

      const occupiedCourtIds = await PlayingSession.find({
        status: 'IN_PROGRESS'
      }).distinct('courtId');

      const availableAlternateCourts = activeCourts.filter(
        (c) => !occupiedCourtIds.some((occId) => occId.toString() === c._id.toString())
      );

      if (availableAlternateCourts.length === 0) {
        return sendError(
          res,
          'Không thể gia hạn: Sân đã kín lịch ca tiếp theo và không còn sân trống nào khác để đổi!',
          409
        );
      }

      return sendSuccess(res, {
        hasConflict: true,
        conflictingBooking: {
          bookingCode: conflictingBooking.bookingCode,
          customerName: conflictingBooking.customerId?.fullName,
          startTime: conflictingBooking.startTime
        },
        alternateCourts: availableAlternateCourts,
        message: `Sân ca tiếp theo đã có lịch đặt của khách "${conflictingBooking.customerId?.fullName}". Bạn có thể đổi đơn đặt sân đó sang sân trống khác hoặc chuyển ca hiện tại.`
      }, 'Phát hiện xung đột lịch ca sau', 200);
    }

    const hourlyRate = await getHourlyRate(session.courtId, currentEndTime);
    const extensionFee = Math.round((hourlyRate / 60) * minutes);

    session.scheduledEndTime = newEndTime;
    session.extensions.push({
      extendedMinutes: minutes,
      extendedFee: extensionFee,
      extendedAt: new Date()
    });
    session.totalAmount += extensionFee;
    session.isNearEnd = false;

    await session.save();

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

    const session = await PlayingSession.findById(id);
    if (!session || session.status !== 'IN_PROGRESS') {
      return sendError(res, 'Ca chơi không tồn tại hoặc đã kết thúc!', 400);
    }

    const newCourt = await Court.findById(newCourtId);
    if (!newCourt || newCourt.status !== 'ACTIVE') {
      return sendError(res, 'Sân mới không hợp lệ hoặc đang dừng hoạt động!', 400);
    }

    const isNewCourtBusy = await PlayingSession.findOne({
      courtId: newCourt._id,
      status: 'IN_PROGRESS'
    });
    if (isNewCourtBusy) {
      return sendError(res, 'Sân mới được chọn hiện đang có người chơi!', 400);
    }

    const oldCourtId = session.courtId;

    session.courtId = newCourt._id;
    session.note = (session.note || '') + ` [Đã chuyển từ sân cũ sang sân ${newCourt.name}. Lý do: ${reason}]`;
    await session.save();

    if (session.bookingId) {
      await Booking.findByIdAndUpdate(session.bookingId, {
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
      await Booking.findByIdAndUpdate(session.bookingId, { status: 'COMPLETED' });
    }

    if (session.courtId) {
      await Court.findByIdAndUpdate(session.courtId._id, { operationalStatus: 'CLEANING' });
      scheduleAutoCleanFinish(session.courtId._id);
    }

    const { customerDisplayName, customerDisplayPhone } = extractCustomerDisplayInfo(session.bookingId);
    const invoiceCode = 'HD-' + Date.now().toString().slice(-6);
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
        consumableFee: totalRentalItemFee - totalDamageFee
      },
      subtotal: session.totalAmount,
      discountAmount: 0,
      totalAmount: session.totalAmount,
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
    const timeSlots = await TimeSlot.find({ status: 'ACTIVE' }).sort({ startTime: 1 }).lean();

    const [year, month, day] = targetDateStr.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    const utcStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const utcEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const minDate = new Date(Math.min(startOfDay.getTime(), utcStart.getTime()));
    const maxDate = new Date(Math.max(endOfDay.getTime(), utcEnd.getTime()));

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
          await Booking.findByIdAndUpdate(s.bookingId._id, { courtId: s.courtId });
        }
      })
    );

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentMinutesOfDay = currentHours * 60 + currentMinutes;

    const todayObj = new Date();
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
    const isCurrentDate = targetDateStr === todayStr;

    const matrix = {};

    courts.forEach((court) => {
      matrix[court._id] = timeSlots.map((slot) => {
        const [slotStartH, slotStartM] = slot.startTime.split(':').map(Number);
        const [slotEndH, slotEndM] = slot.endTime.split(':').map(Number);
        const slotStartTotalMin = slotStartH * 60 + slotStartM;
        const slotEndTotalMin = slotEndH * 60 + slotEndM;

        let matchedBooking = bookings.find(
          (b) =>
            b.courtId &&
            b.courtId.toString() === court._id.toString() &&
            b.startTime === slot.startTime
        );

        if (matchedBooking) {
          const movedSession = activeLiveSessions.find(
            (s) => s.bookingId && s.bookingId._id?.toString() === matchedBooking._id.toString() && s.courtId?.toString() !== court._id.toString()
          );
          if (movedSession) {
            matchedBooking = null;
          }
        }

        let matchedSession = null;
        if (matchedBooking) {
          matchedSession = sessions.find(
            (s) =>
              s.bookingId &&
              s.bookingId._id?.toString() === matchedBooking._id.toString() &&
              s.courtId &&
              s.courtId.toString() === court._id.toString()
          );
        }

        const liveCourtSession = activeLiveSessions.find(
          (s) => s.courtId && s.courtId.toString() === court._id.toString()
        );

        let cellStatus = 'AVAILABLE';
        let isLate = false;
        let lateMinutes = 0;

        if (matchedSession && matchedSession.status === 'IN_PROGRESS') {
          cellStatus = 'IN_PROGRESS';
        } else if (matchedSession && matchedSession.status === 'COMPLETED') {
          cellStatus = 'COMPLETED';
        } else if (matchedBooking) {
          if (matchedBooking.status === 'CHECKED_IN') {
            cellStatus = 'IN_PROGRESS';
          } else if (matchedBooking.status === 'COMPLETED') {
            cellStatus = 'COMPLETED';
          } else {
            cellStatus = matchedBooking.status;
            if (isCurrentDate && currentMinutesOfDay > slotStartTotalMin && cellStatus === 'CONFIRMED') {
              isLate = true;
              lateMinutes = currentMinutesOfDay - slotStartTotalMin;
            }
          }
        } else if (
          isCurrentDate &&
          liveCourtSession &&
          currentMinutesOfDay >= slotStartTotalMin &&
          currentMinutesOfDay < slotEndTotalMin
        ) {
          cellStatus = 'IN_PROGRESS';
          matchedSession = liveCourtSession;
        }

        const bInfo = extractCustomerDisplayInfo(matchedBooking);
        const sInfo = extractCustomerDisplayInfo(matchedSession?.bookingId || liveCourtSession?.bookingId);
        const displayCustomerName = matchedBooking ? bInfo.customerDisplayName : (sInfo.customerDisplayName || 'Khách vãng lai');
        const displayCustomerPhone = matchedBooking ? bInfo.customerDisplayPhone : (sInfo.customerDisplayPhone || '');
        const isWalkIn = matchedBooking ? bInfo.isWalkIn : sInfo.isWalkIn;

        return {
          courtId: court._id,
          timeSlotId: slot._id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: slot.label || `${slot.startTime} - ${slot.endTime}`,
          status: cellStatus,
          isLate,
          lateMinutes,
          booking: matchedBooking
            ? {
                _id: matchedBooking._id,
                bookingCode: matchedBooking.bookingCode,
                status: matchedBooking.status,
                paymentStatus: matchedBooking.paymentStatus,
                totalAmount: matchedBooking.totalAmount,
                startTime: matchedBooking.startTime,
                endTime: matchedBooking.endTime,
                customer: {
                  fullName: displayCustomerName,
                  phone: displayCustomerPhone,
                  email: matchedBooking.customerId?.email || ''
                },
                customerDisplayName: displayCustomerName,
                customerDisplayPhone: displayCustomerPhone,
                isWalkIn,
                note: matchedBooking.note
              }
            : (liveCourtSession?.bookingId
                ? {
                    _id: liveCourtSession.bookingId._id,
                    bookingCode: liveCourtSession.bookingId.bookingCode,
                    status: 'CHECKED_IN',
                    paymentStatus: 'PAID',
                    totalAmount: liveCourtSession.totalAmount || 0,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    customer: {
                      fullName: displayCustomerName,
                      phone: displayCustomerPhone,
                      email: ''
                    },
                    customerDisplayName: displayCustomerName,
                    customerDisplayPhone: displayCustomerPhone,
                    isWalkIn,
                    note: liveCourtSession.bookingId.note
                  }
                : null),
          session: matchedSession
            ? {
                _id: matchedSession._id,
                sessionCode: matchedSession.sessionCode,
                status: matchedSession.status,
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

    return sendSuccess(
      res,
      {
        date: targetDateStr,
        courts,
        timeSlots,
        matrix
      },
      'Lấy sơ đồ ma trận lịch sân thành công!',
      200
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

