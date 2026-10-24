require('dotenv').config();

const dbName = `bcmw_booking_test_suite_${process.pid}_${Date.now()}`;
const baseUri = process.env.BOOKING_TEST_MONGODB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/bad2';
const parsedUri = new URL(baseUri);
parsedUri.pathname = `/${dbName}`;
process.env.MONGODB_URI = parsedUri.toString();

const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Requiring app triggers connectDB with our isolated test database URI
const app = require('./app');

const Booking = require('./src/models/booking');
const Court = require('./src/models/court');
const User = require('./src/models/user');
const TimeSlot = require('./src/models/timeSlot');
const Price = require('./src/models/price');
const Voucher = require('./src/models/voucher');

const JWT_SECRET = process.env.JWT_SECRET || 'badminton_secret_key_2026';

let server;
let port;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Length'] = Buffer.byteLength(dataString);

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve({ status: res.statusCode, body: parsed });
          } catch {
            resolve({ status: res.statusCode, raw: rawData });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(dataString);
    req.end();
  });
}

function makeToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

const runSuite = async () => {
  console.log(`[TEST] Database connected to isolated test DB: ${dbName}`);

  // Start HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
  console.log(`[TEST] HTTP test server listening on port ${port}`);

  const testResults = [];
  const logTest = (id, name, passed, detail = '') => {
    testResults.push({ id, name, passed, detail });
    console.log(`  ${passed ? '✓' : '✗'} [${id}] ${name} ${detail ? '(' + detail + ')' : ''}`);
  };

  try {
    // -------------------------------------------------------------------------
    // SETUP FIXTURES
    // -------------------------------------------------------------------------
    const adminUser = await User.create({
      fullName: 'Admin Test',
      email: `admin_${Date.now()}@test.com`,
      phone: `090${Date.now().toString().slice(-7)}`,
      password: 'hashed_password',
      role: 'ADMIN',
      status: 'ACTIVE'
    });
    const staffUser = await User.create({
      fullName: 'Staff Test',
      email: `staff_${Date.now()}@test.com`,
      phone: `091${Date.now().toString().slice(-7)}`,
      password: 'hashed_password',
      role: 'STAFF',
      status: 'ACTIVE'
    });
    const customerUserA = await User.create({
      fullName: 'Customer Test A',
      email: `customera_${Date.now()}@test.com`,
      phone: `092${Date.now().toString().slice(-7)}`,
      password: 'hashed_password',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      bookingCancellationHistory: []
    });
    const customerUserB = await User.create({
      fullName: 'Customer Test B',
      email: `customerb_${Date.now()}@test.com`,
      phone: `093${Date.now().toString().slice(-7)}`,
      password: 'hashed_password',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      bookingCancellationHistory: []
    });

    const adminToken = makeToken(adminUser);
    const staffToken = makeToken(staffUser);
    const customerTokenA = makeToken(customerUserA);
    const customerTokenB = makeToken(customerUserB);

    const court1 = await Court.create({
      courtName: 'Sân 1 - Thảm Tiêu Chuẩn',
      courtType: 'STANDARD',
      location: 'Khu A',
      openingTime: '06:00',
      closingTime: '23:00',
      status: 'ACTIVE'
    });
    const court2 = await Court.create({
      courtName: 'Sân 2 - Gỗ VIP',
      courtType: 'VIP',
      location: 'Khu VIP',
      openingTime: '06:00',
      closingTime: '23:00',
      status: 'ACTIVE'
    });
    const inactiveCourt = await Court.create({
      courtName: 'Sân Bảo Trì',
      courtType: 'STANDARD',
      location: 'Khu B',
      openingTime: '06:00',
      closingTime: '23:00',
      status: 'INACTIVE'
    });

    // TimeSlots & Prices
    await TimeSlot.create({ startTime: '08:00', endTime: '09:00', label: '08:00 - 09:00', status: 'ACTIVE' });
    await TimeSlot.create({ startTime: '13:00', endTime: '14:00', label: '13:00 - 14:00', status: 'ACTIVE' });
    await TimeSlot.create({ startTime: '18:00', endTime: '19:00', label: '18:00 - 19:00', status: 'ACTIVE' });

    await Price.create({
      courtId: court1._id,
      dayType: 'WEEKDAY',
      timeSlot: '08:00-09:00',
      price: 80000,
      status: 'ACTIVE'
    });
    await Price.create({
      courtId: court1._id,
      dayType: 'WEEKDAY',
      timeSlot: '18:00-19:00',
      price: 130000,
      status: 'ACTIVE'
    });
    await Price.create({
      courtId: court1._id,
      dayType: 'WEEKEND',
      timeSlot: '18:00-19:00',
      price: 130000,
      status: 'ACTIVE'
    });

    // Voucher
    await Voucher.create({
      code: 'GIAM10',
      name: 'Giảm 10%',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      maxDiscountAmount: 50000,
      minInvoiceAmount: 50000,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2030-12-31'),
      usageLimit: 10,
      usedCount: 0,
      status: 'ACTIVE'
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    // =========================================================================
    // GROUP 1: TẠO BOOKING (VALIDATION & PERMISSIONS)
    // =========================================================================
    console.log('\n--- GROUP 1: Tạo Booking ---');

    // TC-CREATE-01: Customer tạo booking hợp lệ -> status: PENDING_APPROVAL
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: tomorrowStr,
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 201 &&
        res.body.data.status === 'PENDING_APPROVAL' &&
        res.body.data.customerId._id === customerUserA._id.toString();
      logTest('TC-CREATE-01', 'Customer tạo booking hợp lệ -> status PENDING_APPROVAL', ok);
    }

    // TC-CREATE-02: Thiếu trường bắt buộc (bookingDate / courtId) -> 400
    {
      const res = await request('POST', '/api/bookings', {
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-CREATE-02', 'Thiếu ngày đặt và sân -> 400 Bad Request', ok, `status: ${res.status}`);
    }

    // TC-CREATE-03: Khung giờ không hợp lệ (startTime >= endTime) -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: tomorrowStr,
        startTime: '10:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-CREATE-03', 'Khung giờ startTime >= endTime -> 400 Bad Request', ok);
    }

    // TC-CREATE-04: Ngày đặt không hợp lệ (chuỗi không phải ngày) -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: 'invalid-date-string',
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-CREATE-04', 'Ngày đặt sai định dạng -> 400 Bad Request (chống 500 RangeError)', ok);
    }

    // TC-CREATE-05: Ngày đặt trong quá khứ -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: '2020-01-01',
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-CREATE-05', 'Ngày đặt trong quá khứ -> 400 Bad Request', ok);
    }

    // =========================================================================
    // GROUP 2: CHỌN SÂN (COURT ELIGIBILITY)
    // =========================================================================
    console.log('\n--- GROUP 2: Chọn Sân ---');

    // TC-COURT-01: Sân không tồn tại -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: new mongoose.Types.ObjectId().toString(),
        bookingDate: tomorrowStr,
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-COURT-01', 'Sân không tồn tại -> 400 Bad Request', ok);
    }

    // TC-COURT-02: Sân bị vô hiệu hóa (INACTIVE) -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: inactiveCourt._id.toString(),
        bookingDate: tomorrowStr,
        startTime: '08:00',
        endTime: '09:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-COURT-02', 'Sân ở trạng thái INACTIVE -> 400 Bad Request', ok);
    }

    // TC-COURT-03: Đặt ngoài giờ mở cửa (05:00 < openingTime 06:00) -> 400
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: tomorrowStr,
        startTime: '05:00',
        endTime: '06:00'
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-COURT-03', 'Đặt ngoài giờ hoạt động của sân -> 400 Bad Request', ok);
    }

    // =========================================================================
    // GROUP 3: TÍNH GIÁ TIỀN & BẢO VỆ DỮ LIỆU
    // =========================================================================
    console.log('\n--- GROUP 3: Giá Tiền & Voucher ---');

    // TC-PRICE-01: Backend tính đúng giá theo giờ cao điểm (18:00-19:00 = 130k)
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '18:00',
        endTime: '19:00'
      }, customerTokenA);
      const ok = res.status === 201 && res.body.data.price === 130000;
      logTest('TC-PRICE-01', 'Tính đúng giá cao điểm 18:00-19:00 từ Database (130.000đ)', ok);
    }

    // TC-PRICE-02: Frontend giả mạo giá (gửi price=1đ) -> Backend ghi đè bằng giá thật
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '08:00',
        endTime: '09:00',
        price: 1,
        totalAmount: 1
      }, customerTokenB);
      const ok = res.status === 201 && res.body.data.price === 80000 && res.body.data.totalAmount === 80000;
      logTest('TC-PRICE-02', 'Client gửi giá giả mạo (1đ) -> Backend tính lại chính xác (80.000đ)', ok);
    }

    // TC-PRICE-03: Áp dụng voucher hợp lệ -> giảm giá chính xác
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: tomorrowStr,
        startTime: '18:00',
        endTime: '19:00',
        voucherCode: 'GIAM10'
      }, customerTokenA);
      const ok = res.status === 201 &&
        res.body.data.price === 130000 &&
        res.body.data.discount === 13000 &&
        res.body.data.totalAmount === 117000;
      logTest('TC-PRICE-03', 'Áp dụng Voucher GIAM10 -> Giảm 13.000đ, tổng tiền 117.000đ', ok);
    }

    // TC-PRICE-04: Áp dụng voucher không hợp lệ hoặc không tồn tại -> báo lỗi
    {
      const res = await request('POST', '/api/bookings/validate-voucher', {
        voucherCode: 'INVALID_CODE',
        orderAmount: 100000
      });
      const ok = res.status === 404;
      logTest('TC-PRICE-04', 'Voucher không tồn tại -> 404 Not Found', ok);
    }

    // =========================================================================
    // GROUP 4: BOOKING NHIỀU SÂN (MULTI-COURT)
    // =========================================================================
    console.log('\n--- GROUP 4: Đặt Nhiều Sân ---');

    let multiBookingId;
    let multiItem1Id;
    let multiItem2Id;
    {
      const res = await request('POST', '/api/bookings', {
        bookingDate: futureDateStr,
        courtOrders: [
          { courtId: court1._id.toString(), startTime: '09:00', endTime: '10:00' },
          { courtId: court2._id.toString(), startTime: '09:00', endTime: '10:00' }
        ]
      }, customerTokenA);
      const ok = res.status === 201 &&
        res.body.data.items?.length === 2 &&
        res.body.data.totalAmount === (res.body.data.items[0].price + res.body.data.items[1].price);
      if (ok) {
        multiBookingId = res.body.data._id;
        multiItem1Id = res.body.data.items[0]._id;
        multiItem2Id = res.body.data.items[1]._id;
      }
      logTest('TC-MULTI-01', 'Tạo booking 2 sân -> items có 2 phần tử, tổng tiền tính đúng', ok);
    }

    // TC-MULTI-02: Đặt trùng giờ nội bộ trên cùng 1 sân trong mảng courtOrders -> 400
    {
      const res = await request('POST', '/api/bookings', {
        bookingDate: futureDateStr,
        courtOrders: [
          { courtId: court1._id.toString(), startTime: '11:00', endTime: '12:00' },
          { courtId: court1._id.toString(), startTime: '11:30', endTime: '12:30' }
        ]
      }, customerTokenA);
      const ok = res.status === 400 && res.body.message.includes('trùng');
      logTest('TC-MULTI-02', 'Trùng giờ nội bộ trên cùng 1 sân trong đơn -> 400 Bad Request', ok);
    }

    // =========================================================================
    // GROUP 5: DUYỆT & TỪ CHỐI BOOKING (APPROVE & REJECT)
    // =========================================================================
    console.log('\n--- GROUP 5: Duyệt & Từ Chối Booking ---');

    let pendingBookingId;
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '13:00',
        endTime: '14:00'
      }, customerTokenA);
      if (res.status !== 201) {
        console.error('Failed to create pending booking at line 405:', res.status, res.body);
      }
      pendingBookingId = res.body?.data?._id;
    }

    // TC-APPROVE-01: Staff duyệt đơn PENDING_APPROVAL -> CONFIRMED
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        status: 'CONFIRMED'
      }, staffToken);
      const ok = res.status === 200 && res.body.data.status === 'CONFIRMED';
      logTest('TC-APPROVE-01', 'Staff duyệt đơn PENDING_APPROVAL -> CONFIRMED', ok);
    }

    // TC-APPROVE-02: Customer thử gọi API duyệt đơn -> 403
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        status: 'CONFIRMED'
      }, customerTokenA);
      const ok = res.status === 403;
      logTest('TC-APPROVE-02', 'Customer gọi API duyệt đơn -> 403 Forbidden', ok);
    }

    // TC-APPROVE-03: Thử duyệt đơn đã CANCELLED -> 409
    let cancelledBookingId;
    {
      const created = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '14:00',
        endTime: '15:00'
      }, customerTokenA);
      await request('PATCH', `/api/bookings/${created.body.data._id}/status`, {
        status: 'CANCELLED'
      }, customerTokenA);
      cancelledBookingId = created.body.data._id;
    }
    {
      const res = await request('PATCH', `/api/bookings/${cancelledBookingId}/status`, {
        status: 'CONFIRMED'
      }, staffToken);
      const ok = res.status === 409;
      logTest('TC-APPROVE-03', 'Thử xác nhận đơn đã bị hủy -> 409 Conflict', ok);
    }

    // TC-REJECT-01: Staff từ chối đơn chờ duyệt kèm lý do -> status REJECTED
    let rejectBookingId;
    {
      const created = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '15:00',
        endTime: '16:00'
      }, customerTokenA);
      rejectBookingId = created.body.data._id;

      const res = await request('PATCH', `/api/bookings/${rejectBookingId}/reject`, {
        reason: 'Sân bận tổ chức giải đấu nội bộ'
      }, staffToken);
      const ok = res.status === 200 &&
        res.body.data.status === 'REJECTED' &&
        res.body.data.note.includes('Sân bận tổ chức giải đấu nội bộ');
      logTest('TC-REJECT-01', 'Staff từ chối yêu cầu đặt sân (AF2) kèm lý do -> REJECTED', ok);
    }

    // TC-REJECT-02: Customer gọi API từ chối đơn -> 403
    {
      const res = await request('PATCH', `/api/bookings/${rejectBookingId}/reject`, {
        reason: 'Khách tự từ chối'
      }, customerTokenA);
      const ok = res.status === 403;
      logTest('TC-REJECT-02', 'Customer gọi API rejectBooking -> 403 Forbidden', ok);
    }

    // =========================================================================
    // GROUP 6: XUNG ĐỘT LỊCH SÂN & CONCURRENCY
    // =========================================================================
    console.log('\n--- GROUP 6: Xung Đột Lịch Sân & Concurrency ---');

    // Đơn đã CONFIRMED tại court1: 13:00-14:00 ngày futureDateStr
    // TC-CONFLICT-01: Đặt trùng khung giờ với booking đã CONFIRMED -> 409 Conflict
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '13:00',
        endTime: '14:00'
      }, customerTokenB);
      const ok = res.status === 409 && res.body.message.includes('không còn khả dụng');
      logTest('TC-CONFLICT-01', 'Đặt trùng khung giờ với booking đã xác nhận -> 409 Conflict', ok);
    }

    // TC-CONFLICT-02: Hai đơn cùng slot; khi đơn 1 đã CONFIRMED, duyệt đơn 2 -> 409
    {
      const bookingA = await Booking.create({
        customerId: customerUserA._id,
        courtId: court2._id,
        bookingCode: `BKTEST${Date.now()}A`,
        bookingDate: futureDate,
        startTime: '20:00',
        endTime: '21:00',
        price: 150000,
        totalAmount: 150000,
        status: 'PENDING_APPROVAL',
        items: [{
          courtId: court2._id,
          courtName: court2.courtName,
          bookingDate: futureDate,
          startTime: '20:00',
          endTime: '21:00',
          price: 150000,
          status: 'ACTIVE'
        }]
      });
      const bookingB = await Booking.create({
        customerId: customerUserB._id,
        courtId: court2._id,
        bookingCode: `BKTEST${Date.now()}B`,
        bookingDate: futureDate,
        startTime: '20:00',
        endTime: '21:00',
        price: 150000,
        totalAmount: 150000,
        status: 'PENDING_APPROVAL',
        items: [{
          courtId: court2._id,
          courtName: court2.courtName,
          bookingDate: futureDate,
          startTime: '20:00',
          endTime: '21:00',
          price: 150000,
          status: 'ACTIVE'
        }]
      });

      // Staff duyệt bookingA -> thành công
      const resA = await request('PATCH', `/api/bookings/${bookingA._id}/status`, { status: 'CONFIRMED' }, staffToken);
      assert.equal(resA.status, 200);

      // Staff thử duyệt bookingB trùng giờ -> phải bị chặn 409
      const resB = await request('PATCH', `/api/bookings/${bookingB._id}/status`, { status: 'CONFIRMED' }, staffToken);
      const ok = resB.status === 409;
      logTest('TC-CONFLICT-02', 'Duyệt đơn thứ 2 trùng giờ với đơn đã CONFIRMED -> 409 Conflict', ok);
    }

    // =========================================================================
    // GROUP 7: CHỈNH SỬA BOOKING (AF1 CHANGE INFO)
    // =========================================================================
    console.log('\n--- GROUP 7: Chỉnh Sửa Booking ---');

    let editBookingId;
    {
      const created = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '16:00',
        endTime: '17:00'
      }, customerTokenA);
      editBookingId = created.body.data._id;
    }

    // TC-EDIT-01: Customer đổi sân hoặc giờ cho đơn chờ duyệt -> tính lại giá, giữ PENDING_APPROVAL
    {
      const res = await request('PATCH', `/api/bookings/${editBookingId}/change-info`, {
        courtOrders: [
          { courtId: court1._id.toString(), startTime: '18:00', endTime: '19:00' }
        ]
      }, customerTokenA);
      const ok = res.status === 200 &&
        res.body.data.startTime === '18:00' &&
        res.body.data.endTime === '19:00' &&
        res.body.data.price === 130000 &&
        res.body.data.status === 'PENDING_APPROVAL';
      logTest('TC-EDIT-01', 'Customer đổi giờ (18:00-19:00) -> cập nhật giá (130k), giữ PENDING_APPROVAL', ok);
    }

    // TC-EDIT-02: Customer thử sửa đơn đã CONFIRMED -> 409
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/change-info`, {
        courtOrders: [{ courtId: court1._id.toString(), startTime: '10:00', endTime: '11:00' }]
      }, customerTokenA);
      const ok = res.status === 409;
      logTest('TC-EDIT-02', 'Customer thử sửa đơn đã CONFIRMED -> 409 Conflict', ok);
    }

    // TC-EDIT-03: Customer thử tự sửa giá tiền trong change-info -> 400
    {
      const res = await request('PATCH', `/api/bookings/${editBookingId}/change-info`, {
        courtOrders: [{ courtId: court1._id.toString(), startTime: '18:00', endTime: '19:00' }],
        price: 50000
      }, customerTokenA);
      const ok = res.status === 400;
      logTest('TC-EDIT-03', 'Customer gửi tham số giá trong change-info -> 400 Bad Request', ok);
    }

    // TC-EDIT-04: Customer sửa vào khung giờ đã bị CONFIRMED bởi đơn khác -> 409
    {
      const res = await request('PATCH', `/api/bookings/${editBookingId}/change-info`, {
        courtOrders: [{ courtId: court1._id.toString(), startTime: '13:00', endTime: '14:00' }]
      }, customerTokenA);
      const ok = res.status === 409;
      logTest('TC-EDIT-04', 'Sửa sang giờ đã có đơn khác CONFIRMED (13:00-14:00) -> 409 Conflict', ok);
    }

    // TC-EDIT-05: Customer sửa đơn của người khác -> 403
    {
      const res = await request('PATCH', `/api/bookings/${editBookingId}/change-info`, {
        courtOrders: [{ courtId: court1._id.toString(), startTime: '07:00', endTime: '08:00' }]
      }, customerTokenB);
      const ok = res.status === 403;
      logTest('TC-EDIT-05', 'Customer B sửa đơn của Customer A -> 403 Forbidden', ok);
    }

    // =========================================================================
    // GROUP 8: HỦY BOOKING (CUSTOMER & STAFF)
    // =========================================================================
    console.log('\n--- GROUP 8: Hủy Booking & Hủy Từng Sân ---');

    // TC-CANCEL-01: Customer hủy toàn bộ booking trước giờ chơi -> CANCELLED
    let cancelBookingTestId;
    {
      const created = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '07:00',
        endTime: '08:00'
      }, customerTokenA);
      cancelBookingTestId = created.body.data._id;

      const res = await request('PATCH', `/api/bookings/${cancelBookingTestId}/status`, {
        status: 'CANCELLED'
      }, customerTokenA);
      const ok = res.status === 200 && res.body.data.status === 'CANCELLED';
      logTest('TC-CANCEL-01', 'Customer hủy booking thành công -> status CANCELLED', ok);
    }

    // TC-CANCEL-02: Customer hủy lại đơn đã CANCELLED -> 409
    {
      const res = await request('PATCH', `/api/bookings/${cancelBookingTestId}/status`, {
        status: 'CANCELLED'
      }, customerTokenA);
      const ok = res.status === 409;
      logTest('TC-CANCEL-02', 'Thực hiện thao tác hủy lặp lại trên đơn đã hủy -> 409 Conflict', ok);
    }

    // TC-CANCEL-03: Hủy 1 sân trong booking nhiều sân -> sân đó CANCELLED, sân kia ACTIVE, giá cập nhật
    if (multiBookingId && multiItem1Id && multiItem2Id) {
      const res = await request('PATCH', `/api/bookings/${multiBookingId}/status`, {
        status: 'CANCELLED',
        itemId: multiItem1Id
      }, customerTokenA);
      const items = res.body.data.items;
      const it1 = items.find((it) => it._id === multiItem1Id);
      const it2 = items.find((it) => it._id === multiItem2Id);
      const ok = res.status === 200 &&
        it1.status === 'CANCELLED' &&
        it2.status === 'ACTIVE' &&
        res.body.data.status !== 'CANCELLED' &&
        res.body.data.totalAmount === it2.price;
      logTest('TC-CANCEL-03', 'Hủy 1 sân trong đơn 2 sân -> sân 1 CANCELLED, sân 2 ACTIVE, tổng tiền cập nhật', ok);
    }

    // TC-CANCEL-04: Customer hủy đơn của người khác -> 403
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        status: 'CANCELLED'
      }, customerTokenB);
      const ok = res.status === 403;
      logTest('TC-CANCEL-04', 'Customer B thử hủy đơn của Customer A -> 403 Forbidden', ok);
    }

    // TC-CANCEL-05: Thử hủy đơn quá khứ (đã qua giờ bắt đầu) -> 409
    {
      const pastBooking = await Booking.create({
        customerId: customerUserA._id,
        courtId: court1._id,
        bookingCode: `BKPAST${Date.now()}`,
        bookingDate: new Date('2020-01-01'),
        startTime: '08:00',
        endTime: '09:00',
        price: 80000,
        totalAmount: 80000,
        status: 'CONFIRMED',
        items: [{
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: new Date('2020-01-01'),
          startTime: '08:00',
          endTime: '09:00',
          price: 80000,
          status: 'ACTIVE'
        }]
      });
      const res = await request('PATCH', `/api/bookings/${pastBooking._id}/status`, {
        status: 'CANCELLED'
      }, customerTokenA);
      const ok = res.status === 409 && res.body.message.includes('vượt quá');
      logTest('TC-CANCEL-05', 'Hủy đơn đã qua giờ bắt đầu -> 409 Conflict', ok);
    }

    // =========================================================================
    // GROUP 9: THANH TOÁN TIỀN MẶT TẠI QUẦY
    // =========================================================================
    console.log('\n--- GROUP 9: Thanh Toán Tiền Mặt ---');

    // TC-PAY-01: Staff ghi nhận thanh toán tiền mặt cho đơn CONFIRMED -> PAID
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        paymentStatus: 'PAID'
      }, staffToken);
      const ok = res.status === 200 && res.body.data.paymentStatus === 'PAID';
      logTest('TC-PAY-01', 'Staff ghi nhận thanh toán CASH cho đơn CONFIRMED -> paymentStatus PAID', ok);
    }

    // TC-PAY-02: Ghi nhận thanh toán trùng (đơn đã PAID) -> 409
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        paymentStatus: 'PAID'
      }, staffToken);
      const ok = res.status === 409 && res.body.message.includes('trước đó');
      logTest('TC-PAY-02', 'Ghi nhận thanh toán trùng trên đơn đã PAID -> 409 Conflict', ok);
    }

    // TC-PAY-03: Thử ghi nhận thanh toán cho đơn CANCELLED -> 409
    {
      const res = await request('PATCH', `/api/bookings/${cancelBookingTestId}/status`, {
        paymentStatus: 'PAID'
      }, staffToken);
      const ok = res.status === 409 && (res.body.message.includes('CANCELLED') || res.body.message.includes('hủy'));
      logTest('TC-PAY-03', 'Ghi nhận thanh toán cho đơn CANCELLED -> 409 Conflict', ok);
    }

    // TC-PAY-04: Thử ghi nhận thanh toán cho đơn PENDING_APPROVAL -> 409
    {
      const pendingPayBooking = await Booking.create({
        customerId: customerUserA._id,
        courtId: court1._id,
        bookingCode: `BKPENDPAY${Date.now()}`,
        bookingDate: futureDate,
        startTime: '11:00',
        endTime: '12:00',
        price: 80000,
        totalAmount: 80000,
        status: 'PENDING_APPROVAL',
        paymentStatus: 'UNPAID'
      });
      const res = await request('PATCH', `/api/bookings/${pendingPayBooking._id}/status`, {
        paymentStatus: 'PAID'
      }, staffToken);
      const ok = res.status === 409;
      logTest('TC-PAY-04', 'Ghi nhận thanh toán cho đơn PENDING_APPROVAL -> 409 Conflict', ok);
    }

    // TC-PAY-05: Customer gọi API ghi nhận thanh toán -> 403
    {
      const res = await request('PATCH', `/api/bookings/${pendingBookingId}/status`, {
        paymentStatus: 'PAID'
      }, customerTokenA);
      const ok = res.status === 403;
      logTest('TC-PAY-05', 'Customer gọi API cập nhật paymentStatus -> 403 Forbidden', ok);
    }

    // =========================================================================
    // GROUP 10: PHÂN QUYỀN & BẢO MẬT (RBAC)
    // =========================================================================
    console.log('\n--- GROUP 10: Phân Quyền & Bảo Mật ---');

    // TC-RBAC-01: Customer gọi GET /bookings/customers -> 403
    {
      const res = await request('GET', '/api/bookings/customers', null, customerTokenA);
      const ok = res.status === 403;
      logTest('TC-RBAC-01', 'Customer gọi GET /bookings/customers -> 403 Forbidden (chống rò rỉ dữ liệu)', ok);
    }

    // TC-RBAC-02: Staff/Admin gọi GET /bookings/customers -> 200
    {
      const res = await request('GET', '/api/bookings/customers', null, staffToken);
      const ok = res.status === 200 && Array.isArray(res.body.data);
      logTest('TC-RBAC-02', 'Staff gọi GET /bookings/customers -> 200 OK', ok);
    }

    // TC-RBAC-03: Customer gọi GET /bookings?customerId=<other> -> chỉ nhận đơn của chính mình
    {
      const res = await request('GET', `/api/bookings?customerId=${customerUserB._id}`, null, customerTokenA);
      const ok = res.status === 200 &&
        res.body.data.bookings.every((b) => b.customerId._id === customerUserA._id.toString());
      logTest('TC-RBAC-03', 'Customer truyền customerId của người khác -> Backend chỉ trả đơn của chính họ', ok);
    }

    // TC-RBAC-04: Customer gọi GET /bookings/:id của người khác -> 403
    {
      const res = await request('GET', `/api/bookings/${pendingBookingId}`, null, customerTokenB);
      const ok = res.status === 403;
      logTest('TC-RBAC-04', 'Customer B xem chi tiết đơn của Customer A qua ID -> 403 Forbidden', ok);
    }

    // =========================================================================
    // GROUP 11: QUY TẮC BR-49 (HỦY ĐƠN ĐÃ XÁC NHẬN & KHÓA TÀI KHOẢN)
    // =========================================================================
    console.log('\n--- GROUP 11: Quy Tắc BR-49 ---');

    const br49User = await User.create({
      fullName: 'Khách BR49 Test',
      email: `br49_${Date.now()}@test.com`,
      phone: `097${Date.now().toString().slice(-7)}`,
      password: 'hashed_password',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      bookingCancellationHistory: []
    });
    const br49Token = makeToken(br49User);

    const createAndConfirmBooking = async (startTime, endTime) => {
      const b = await Booking.create({
        customerId: br49User._id,
        courtId: court1._id,
        bookingCode: `BKBR49_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        bookingDate: futureDate,
        startTime,
        endTime,
        price: 80000,
        totalAmount: 80000,
        status: 'CONFIRMED',
        items: [{
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: futureDate,
          startTime,
          endTime,
          price: 80000,
          status: 'ACTIVE'
        }]
      });
      return b._id;
    };

    // TC-BR49-01: Lần hủy 1 -> status CANCELLED, tài khoản vẫn ACTIVE, count = 1
    const cancel1Id = await createAndConfirmBooking('07:00', '08:00');
    {
      const res = await request('PATCH', `/api/bookings/${cancel1Id}/status`, { status: 'CANCELLED' }, br49Token);
      const user = await User.findById(br49User._id);
      const ok = res.status === 200 && user.status === 'ACTIVE' && res.body.data.cancellationResult.cancellationCount === 1;
      logTest('TC-BR49-01', 'Hủy đơn đã CONFIRMED lần 1 -> tài khoản ACTIVE, count = 1', ok);
    }

    // TC-BR49-02: Lần hủy 2 -> status CANCELLED, tài khoản vẫn ACTIVE, count = 2
    const cancel2Id = await createAndConfirmBooking('08:00', '09:00');
    {
      const res = await request('PATCH', `/api/bookings/${cancel2Id}/status`, { status: 'CANCELLED' }, br49Token);
      const user = await User.findById(br49User._id);
      const ok = res.status === 200 && user.status === 'ACTIVE' && res.body.data.cancellationResult.cancellationCount === 2;
      logTest('TC-BR49-02', 'Hủy đơn đã CONFIRMED lần 2 -> tài khoản ACTIVE, count = 2', ok);
    }

    // TC-BR49-03: Lần hủy 3 -> status CANCELLED, tài khoản bị LOCKED theo BR-49
    const cancel3Id = await createAndConfirmBooking('09:00', '10:00');
    {
      const res = await request('PATCH', `/api/bookings/${cancel3Id}/status`, { status: 'CANCELLED' }, br49Token);
      const user = await User.findById(br49User._id);
      const ok = res.status === 200 &&
        user.status === 'LOCKED' &&
        user.lockReason.includes('giới hạn 3 lần') &&
        res.body.data.cancellationResult.accountLocked === true;
      logTest('TC-BR49-03', 'Hủy đơn đã CONFIRMED lần 3 trong tháng -> tài khoản bị LOCKED theo BR-49', ok);
    }

    // TC-BR49-04: Khách bị khóa cố tạo booking mới (authenticated) -> 403
    {
      const res = await request('POST', '/api/bookings', {
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '10:00',
        endTime: '11:00'
      }, br49Token);
      const ok = res.status === 403;
      logTest('TC-BR49-04', 'Khách hàng bị khóa gọi API tạo booking -> 403 Forbidden', ok);
    }

    // TC-BR49-05: Khách bị khóa thử tạo booking dạng khách vãng lai bằng số điện thoại đã bị khóa -> 403
    {
      const res = await request('POST', '/api/bookings', {
        customerName: 'Khách Lách Luật',
        customerPhone: br49User.phone,
        courtId: court1._id.toString(),
        bookingDate: futureDateStr,
        startTime: '10:00',
        endTime: '11:00'
      });
      const ok = res.status === 403 && res.body.message.includes('khóa');
      logTest('TC-BR49-05', 'Khách hàng bị khóa lách luật đặt qua số điện thoại vãng lai -> 403 Forbidden', ok);
    }

    // =========================================================================
    // GROUP 12: AVAILABILITY & ISBOOKED FLAG
    // =========================================================================
    console.log('\n--- GROUP 12: Court Availability API ---');

    // TC-AVAIL-01: Public/Customer xem availability -> có trường isBooked, không lộ bookingCode
    {
      const res = await request('GET', `/api/bookings/availability?courtId=${court1._id}&bookingDate=${futureDateStr}`);
      const slots = res.body.data?.slots || [];
      const slot13 = slots.find((s) => s.startTime === '13:00');
      const ok = res.status === 200 &&
        slot13 &&
        slot13.isBooked === true &&
        slot13.bookingCode === undefined;
      logTest('TC-AVAIL-01', 'Public xem availability -> có isBooked: true, không lộ bookingCode nhạy cảm', ok);
    }

    // TC-AVAIL-02: Staff/Admin xem availability -> có cả isBooked và bookingCode
    {
      const res = await request('GET', `/api/bookings/availability?courtId=${court1._id}&bookingDate=${futureDateStr}`, null, staffToken);
      const slots = res.body.data?.slots || [];
      const slot13 = slots.find((s) => s.startTime === '13:00');
      const ok = res.status === 200 &&
        slot13 &&
        slot13.isBooked === true &&
        typeof slot13.bookingCode === 'string';
      logTest('TC-AVAIL-02', 'Staff xem availability -> có cả isBooked và bookingCode phục vụ quản lý', ok);
    }

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    const total = testResults.length;
    const passed = testResults.filter((t) => t.passed).length;
    const failed = total - passed;

    console.log('\n======================================================');
    console.log(`BÁO CÁO KẾT QUẢ KIỂM THỬ: ${passed}/${total} PASS (${failed} FAIL)`);
    console.log('======================================================');

    if (failed > 0) {
      console.error('Một số test case không đạt:');
      testResults.filter((t) => !t.passed).forEach((t) => {
        console.error(`  - [${t.id}] ${t.name}: ${t.detail}`);
      });
      process.exit(1);
    }
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`[TEST] Cleaned up and dropped test database: ${dbName}`);
  }
};

runSuite().catch((err) => {
  console.error('[TEST SUITE CRASH]:', err);
  process.exit(1);
});
