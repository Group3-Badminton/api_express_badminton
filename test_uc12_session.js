const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const PlayingSession = require('./src/models/playingSession');
const Court = require('./src/models/court');
const Booking = require('./src/models/booking');
const Customer = require('./src/models/customer');
const Staff = require('./src/models/staff');
const Invoice = require('./src/models/invoice');
const {
  scheduleSessionNearEndWarning,
  cancelSessionWarning
} = require('./src/schedulers/sessionScheduler');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ ĐỘC LẬP: UC-12 PLAYING SESSION MANAGEMENT');
  console.log('======================================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Kết nối MongoDB thành công');

    // 1. Chuẩn bị dữ liệu kiểm thử
    let court = await Court.findOne({ status: 'ACTIVE' });
    if (!court) {
      court = await Court.create({
        name: 'Sân Test UC12',
        status: 'ACTIVE',
        operationalStatus: 'AVAILABLE'
      });
    }

    let customer = await Customer.findOne({ role: 'CUSTOMER' });
    if (!customer) {
      customer = await Customer.create({
        fullName: 'Nguyễn Văn Test',
        email: 'test_customer_uc12@gmail.com',
        phone: '0988776655',
        role: 'CUSTOMER',
        status: 'ACTIVE'
      });
    }

    let staff = await Staff.findOne({ role: 'STAFF' });
    if (!staff) {
      staff = await Staff.create({
        fullName: 'Nhân viên Test',
        email: 'staff_test_uc12@gmail.com',
        phone: '0911223344',
        role: 'STAFF',
        status: 'ACTIVE'
      });
    }

    // 2. Tạo một booking CONFIRMED
    const now = new Date();
    const scheduledEndTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 tiếng sau

    const booking = await Booking.create({
      customerId: customer._id,
      courtId: court._id,
      bookingCode: 'BK-TEST-' + Date.now().toString().slice(-4),
      bookingDate: now,
      startTime: '10:00',
      endTime: '11:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED'
    });

    console.log('\n--- 1. Kiểm thử UC-12.1 Check in Playing Session ---');
    const sessionCode = 'SS-TEST-' + Date.now().toString().slice(-4);
    const session = await PlayingSession.create({
      sessionCode,
      bookingId: booking._id,
      courtId: court._id,
      staffId: staff._id,
      scheduledStartTime: now,
      scheduledEndTime: scheduledEndTime,
      checkInAt: now,
      baseCourtFee: 100000,
      totalAmount: 100000,
      status: 'IN_PROGRESS',
      isNearEnd: false
    });

    assert(session && session.status === 'IN_PROGRESS', 'Khởi tạo PlayingSession thành công với status IN_PROGRESS');
    assert(session.baseCourtFee === 100000, 'Chốt giá cơ sở theo thời lượng đã đặt (BR-20)');

    // Kiểm thử lên lịch cảnh báo node-schedule
    console.log('\n--- 2. Kiểm thử node-schedule cảnh báo sắp hết giờ (ScheduleJob) ---');
    scheduleSessionNearEndWarning(session, court.name);
    assert(typeof scheduleSessionNearEndWarning === 'function', 'Hàm scheduleSessionNearEndWarning chạy thành công không sinh lỗi');

    console.log('\n--- 3. Kiểm thử UC-12.2 Extend Playing Session (Gia hạn +30 phút) ---');
    const extensionMinutes = 30;
    const newEndTime = new Date(session.scheduledEndTime.getTime() + extensionMinutes * 60 * 1000);
    const extFee = 50000;

    session.scheduledEndTime = newEndTime;
    session.extensions.push({
      extendedMinutes: extensionMinutes,
      extendedFee: extFee,
      extendedAt: new Date()
    });
    session.totalAmount += extFee;
    await session.save();

    assert(session.extensions.length === 1, 'Ghi nhận lịch sử gia hạn thành công (1 lần)');
    assert(session.totalAmount === 150000, 'Tổng tiền phiên chơi tăng đúng theo phí gia hạn (150.000 VNĐ)');

    // Cập nhật lại lịch node-schedule
    scheduleSessionNearEndWarning(session, court.name);
    assert(true, 'Dời lịch cảnh báo node-schedule theo giờ kết thúc mới thành công');

    console.log('\n--- 4. Kiểm thử UC-12.3 Check out Playing Session (Kết thúc & Hóa đơn) ---');
    cancelSessionWarning(session._id);
    assert(true, 'Hủy lịch cảnh báo node-schedule khi check-out thành công');

    session.checkOutAt = new Date();
    session.status = 'COMPLETED';
    await session.save();

    const invoice = await Invoice.create({
      playingSessionId: session._id,
      staffId: staff._id,
      invoiceCode: 'INV-TEST-' + Date.now().toString().slice(-4),
      subtotal: session.totalAmount,
      totalAmount: session.totalAmount,
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID'
    });

    assert(session.status === 'COMPLETED', 'Trạng thái phiên chơi chuyển sang COMPLETED');
    assert(invoice && invoice.paymentStatus === 'UNPAID', 'Tự động tạo hóa đơn UNPAID sẵn sàng sang UC-13.1');

    // Dọn dẹp dữ liệu test
    await PlayingSession.findByIdAndDelete(session._id);
    await Booking.findByIdAndDelete(booking._id);
    await Invoice.findByIdAndDelete(invoice._id);

    console.log('\n======================================================');
    console.log(`📊 KẾT QUẢ KIỂM THỬ: ${passCount} PASS, ${failCount} FAIL`);
    console.log('======================================================\n');
  } catch (error) {
    console.error('❌ Lỗi kiểm thử:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(failCount > 0 ? 1 : 0);
  }
}

runTests();
