const schedule = require('node-schedule');
const PlayingSession = require('../models/playingSession');
const Court = require('../models/court');
const Booking = require('../models/booking');
const Notification = require('../models/notification');

// Map lưu trữ các jobs cảnh báo theo sessionId để có thể hủy hoặc dời lịch khi gia hạn
const warningJobs = new Map();

/**
 * 1. Đặt lịch cảnh báo sắp hết giờ chơi (mặc định trước 10 phút)
 * @param {Object} session - Bản ghi PlayingSession
 * @param {String} courtName - Tên sân
 */
function scheduleSessionNearEndWarning(session, courtName = 'Sân') {
  if (!session || !session._id || !session.scheduledEndTime) return;

  const sessionId = session._id.toString();
  const jobKey = `near_end_${sessionId}`;

  // Hủy job cũ nếu đã tồn tại (ví dụ vừa gia hạn giờ chơi)
  if (warningJobs.has(jobKey)) {
    const existingJob = warningJobs.get(jobKey);
    if (existingJob) existingJob.cancel();
    warningJobs.delete(jobKey);
  }

  // Mốc cảnh báo: trước scheduledEndTime 10 phút
  const warningMinutes = 10;
  const warningTime = new Date(new Date(session.scheduledEndTime).getTime() - warningMinutes * 60 * 1000);
  const now = new Date();

  // Nếu thời điểm cảnh báo đã đến hoặc đã qua nhưng phiên chưa kết thúc
  if (warningTime <= now) {
    triggerWarning(sessionId, session.sessionCode, courtName);
    return;
  }

  console.log(`[SCHEDULE] Đã lên lịch cảnh báo cho phiên ${session.sessionCode || sessionId} vào lúc: ${warningTime.toLocaleTimeString('vi-VN')} (${warningTime.toISOString()})`);

  // Sử dụng node-schedule
  const job = schedule.scheduleJob(warningTime, async () => {
    await triggerWarning(sessionId, session.sessionCode, courtName);
    warningJobs.delete(jobKey);
  });

  if (job) {
    warningJobs.set(jobKey, job);
  }
}

/**
 * 2. Thực thi kích hoạt cảnh báo
 */
async function triggerWarning(sessionId, sessionCode, courtName) {
  try {
    const session = await PlayingSession.findById(sessionId);
    if (!session || session.status !== 'IN_PROGRESS') {
      return;
    }

    // Bật cờ cảnh báo sắp hết giờ
    session.isNearEnd = true;
    await session.save();

    console.log(`[ALERT] 🔔 Phiên chơi ${sessionCode || sessionId} tại sân ${courtName} CÒN 10 PHÚT LÀ HẾT GIỜ!`);

    // Gửi thông báo đến nhân viên quầy
    try {
      await Notification.create({
        recipientId: session.staffId || session._id,
        recipientType: 'STAFF',
        type: 'SESSION_NEAR_END',
        title: `Cảnh báo: ${courtName} sắp hết giờ chơi!`,
        message: `Phiên chơi #${sessionCode || sessionId} tại ${courtName} sẽ kết thúc trong 10 phút. Vui lòng nhắc khách hoặc hỏi khách có muốn gia hạn (Extend) không.`,
        isRead: false
      });
    } catch (notifErr) {
      console.error('[SCHEDULE] Lỗi khi tạo Notification:', notifErr.message);
    }
  } catch (error) {
    console.error(`[SCHEDULE ERROR] Lỗi khi kích hoạt cảnh báo phiên ${sessionId}:`, error.message);
  }
}

/**
 * 3. Hủy lịch cảnh báo (Dùng khi khách Check-out hoặc Hủy phiên)
 */
function cancelSessionWarning(sessionId) {
  if (!sessionId) return;
  const jobKey = `near_end_${sessionId.toString()}`;
  if (warningJobs.has(jobKey)) {
    const job = warningJobs.get(jobKey);
    if (job) job.cancel();
    warningJobs.delete(jobKey);
    console.log(`[SCHEDULE] Đã hủy lịch cảnh báo cho phiên ${sessionId}`);
  }
}

/**
 * 4. Tự động chuyển trạng thái sân từ CLEANING sang AVAILABLE sau 10 phút dọn dẹp
 */
function scheduleAutoCleanFinish(courtId) {
  if (!courtId) return;
  const cleanFinishTime = new Date(Date.now() + 10 * 60 * 1000); // 10 phút sau
  
  schedule.scheduleJob(cleanFinishTime, async () => {
    try {
      const court = await Court.findById(courtId);
      if (court && court.operationalStatus === 'CLEANING') {
        court.operationalStatus = 'AVAILABLE';
        await court.save();
        console.log(`[SCHEDULE] Sân ${court.name} đã hoàn tất dọn dẹp, chuyển về trạng thái AVAILABLE.`);
      }
    } catch (err) {
      console.error('[SCHEDULE ERROR] Lỗi tự động chuyển dọn dẹp sân:', err.message);
    }
  });
}

/**
 * 5. Khôi phục các job cảnh báo khi khởi động lại Server (Server Restart Recovery)
 */
async function restoreActiveSessionJobs() {
  try {
    const activeSessions = await PlayingSession.find({
      status: 'IN_PROGRESS',
      scheduledEndTime: { $gt: new Date() }
    }).populate('courtId', 'name');

    for (const session of activeSessions) {
      const courtName = session.courtId?.name || 'Sân';
      scheduleSessionNearEndWarning(session, courtName);
    }
    console.log(`[SCHEDULE] Đã khôi phục thành công ${activeSessions.length} lịch cảnh báo phiên chơi đang hoạt động.`);
  } catch (err) {
    console.error('[SCHEDULE ERROR] Khôi phục jobs thất bại:', err.message);
  }
}

async function autoCancelLateBookings() {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const localStartOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const localEndOfDay = new Date(year, month, day, 23, 59, 59, 999);
    const utcStartOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const utcEndOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    const minToday = new Date(Math.min(localStartOfDay.getTime(), utcStartOfDay.getTime()));
    const maxToday = new Date(Math.max(localEndOfDay.getTime(), utcEndOfDay.getTime()));

    // 1. Tự động hủy tất cả đơn CONFIRMED ở ngày quá khứ
    const pastBookings = await Booking.find({
      status: 'CONFIRMED',
      bookingDate: { $lt: minToday }
    });

    for (const b of pastBookings) {
      try {
        const updateDoc = {
          $set: {
            status: 'CANCELLED',
            cancellationReason: 'Tự động hủy do quá hạn ngày nhận sân'
          },
          $push: {
            cancellationHistory: {
              cancelledAt: now,
              cancelledByRole: 'STAFF',
              previousStatus: 'CONFIRMED',
              scope: 'BOOKING'
            }
          }
        };
        if (Array.isArray(b.items) && b.items.length > 0) {
          updateDoc.$set['items.$[].status'] = 'CANCELLED';
        }
        await Booking.updateOne({ _id: b._id }, updateDoc);
        console.log(`[AUTO-CANCEL] Đã hủy đơn quá hạn ngày #${b.bookingCode}`);
      } catch (err) {
        console.error(`[AUTO-CANCEL ERROR] Lỗi hủy đơn quá hạn #${b.bookingCode}:`, err.message);
      }
    }

    // 2. Tự động hủy đơn trong ngày hôm nay nếu đến trễ quá 15 phút
    const todayBookings = await Booking.find({
      status: 'CONFIRMED',
      bookingDate: { $gte: minToday, $lte: maxToday }
    });

    for (const b of todayBookings) {
      try {
        let effectiveStartTime = b.startTime;
        if (!effectiveStartTime && Array.isArray(b.items) && b.items.length > 0) {
          effectiveStartTime = b.items[0]?.startTime;
        }

        if (!effectiveStartTime || typeof effectiveStartTime !== 'string' || !effectiveStartTime.includes(':')) {
          continue;
        }

        const [sh, sm] = effectiveStartTime.trim().split(':').map(Number);
        const startMin = (sh || 0) * 60 + (sm || 0);

        if (currentMinutes > startMin + 15) {
          const updateDoc = {
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
          };
          if (Array.isArray(b.items) && b.items.length > 0) {
            updateDoc.$set['items.$[].status'] = 'CANCELLED';
          }
          await Booking.updateOne({ _id: b._id }, updateDoc);
          console.log(`[AUTO-CANCEL] Đã tự động hủy đơn #${b.bookingCode} (Giờ hẹn: ${effectiveStartTime}, trễ ${currentMinutes - startMin} phút)`);
        }
      } catch (err) {
        console.error(`[AUTO-CANCEL ERROR] Lỗi hủy đơn trễ #${b.bookingCode}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[AUTO-CANCEL ERROR]', err.message);
  }
}

schedule.scheduleJob('*/1 * * * *', autoCancelLateBookings);

module.exports = {
  scheduleSessionNearEndWarning,
  cancelSessionWarning,
  scheduleAutoCleanFinish,
  restoreActiveSessionJobs,
  autoCancelLateBookings
};
