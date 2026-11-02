const fetch = globalThis.fetch;
const mongoose = require('mongoose');

const BASE_URL = 'http://127.0.0.1:9999/api';

async function runTests() {
  console.log('================================================================');
  console.log('=== BẮT ĐẦU KIỂM THỬ 12 BUSINESS RULES CỦA CHỨC NĂNG BOOKING ===');
  console.log('================================================================\n');

  // 1. Đăng nhập Customer và Admin
  console.log('[Setup] Đăng nhập tài khoản...');
  const customerLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'customer@gmail.com', password: '123456' })
  }).then(r => r.json());

  const customerToken = customerLogin.data?.token || customerLogin.data?.accessToken;

  const adminLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@gmail.com', password: '123456' })
  }).then(r => r.json());

  const adminToken = adminLogin.data?.token || adminLogin.data?.accessToken;

  if (!customerToken) throw new Error('Không thể đăng nhập Customer: ' + JSON.stringify(customerLogin));
  if (!adminToken) throw new Error('Không thể đăng nhập Admin: ' + JSON.stringify(adminLogin));
  console.log('  Customer Token: OK');
  console.log('  Admin Token: OK\n');

  // Lấy danh sách sân
  const courtsRes = await fetch(`${BASE_URL}/bookings/courts`).then(r => r.json());
  const courts = courtsRes.data || [];
  if (courts.length < 2) {
    throw new Error('Cần ít nhất 2 sân để kiểm thử!');
  }
  const court1 = courts[0];
  const court2 = courts[1];
  console.log(`[Setup] Sân sử dụng kiểm thử: ${court1.courtName} (${court1._id}), ${court2.courtName} (${court2._id})\n`);

  // Tính các mốc ngày (Giờ VN: UTC+7)
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;

  const yesterdayDate = new Date(vnNow.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = `${yesterdayDate.getUTCFullYear()}-${pad(yesterdayDate.getUTCMonth() + 1)}-${pad(yesterdayDate.getUTCDate())}`;

  const futureDate = new Date(vnNow.getTime() + 10 * 24 * 60 * 60 * 1000);
  const futureStr = `${futureDate.getUTCFullYear()}-${pad(futureDate.getUTCMonth() + 1)}-${pad(futureDate.getUTCDate())}`;

  const currentHour = vnNow.getUTCHours();
  const currentMinute = vnNow.getUTCMinutes();
  const pastTimeStr = '07:00';
  const pastEndTimeStr = '08:00';
  const currentTimeStr = `${pad(currentHour)}:${pad(currentMinute)}`;
  // Đảm bảo test 3 endTime luôn hợp lệ và > startTime
  let test3Start = currentTimeStr;
  let test3End = `${pad((currentHour + 1) % 24)}:00`;
  if (currentHour === 23) {
    if (currentMinute < 55) {
      test3End = '23:59';
    } else {
      test3Start = '23:00';
      test3End = '23:55';
    }
  }

  const results = [];

  function record(stt, title, passed, details) {
    results.push({ stt, title, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[Test ${stt}] ${mark}: ${title}`);
    console.log(`   Chi tiết: ${details}\n`);
  }

  // TEST 1: Đặt sân ngày hôm qua -> Từ chối
  try {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: yesterdayStr,
            startTime: '08:00',
            endTime: '09:00'
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 1 - Đặt ngày hôm qua'
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && data.message.includes('quá khứ');
    record(1, 'Đặt sân ngày hôm qua', passed, `Status: ${res.status}, Message: "${data.message}"`);
  } catch (err) {
    record(1, 'Đặt sân ngày hôm qua', false, err.message);
  }

  // TEST 2: Đặt sân giờ đã qua trong ngày hôm nay -> Từ chối
  try {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: todayStr,
            startTime: pastTimeStr,
            endTime: pastEndTimeStr
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 2 - Đặt giờ đã qua hôm nay'
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && (data.message.includes('thời gian hiện tại') || data.message.includes('quá khứ'));
    record(2, 'Đặt sân giờ đã qua', passed, `Status: ${res.status}, Message: "${data.message}"`);
  } catch (err) {
    record(2, 'Đặt sân giờ đã qua', false, err.message);
  }

  // TEST 3: Đặt sân đúng thời điểm hiện tại -> Từ chối
  try {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: todayStr,
            startTime: test3Start,
            endTime: test3End
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 3 - Đặt đúng thời điểm hiện tại'
      })
    });
    const data = await res.json();
    const passed = res.status === 400 && (data.message.includes('thời gian hiện tại') || data.message.includes('quá khứ'));
    record(3, 'Đặt sân đúng thời điểm hiện tại', passed, `Status: ${res.status}, Message: "${data.message}"`);
  } catch (err) {
    record(3, 'Đặt sân đúng thời điểm hiện tại', false, err.message);
  }

  // TEST 4: Đặt sân giờ tương lai -> Cho phép nếu còn trống
  let futureBooking1 = null;
  try {
    const res = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: futureStr,
            startTime: '08:00',
            endTime: '09:00'
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 4 - Đặt giờ tương lai'
      })
    });
    const data = await res.json();
    const passed = (res.status === 201 || res.status === 200) && data.success && data.data?._id;
    if (passed) futureBooking1 = data.data;
    record(4, 'Đặt sân giờ tương lai', passed, `Status: ${res.status}, BookingCode: ${data.data?.bookingCode}, BookingStatus: ${data.data?.status}`);
  } catch (err) {
    record(4, 'Đặt sân giờ tương lai', false, err.message);
  }

  // TEST 5: Hủy đơn PENDING_APPROVAL trước giờ chơi -> Cho phép & giải phóng sân
  try {
    if (!futureBooking1) throw new Error('Không có futureBooking1 để kiểm thử');
    const res = await fetch(`${BASE_URL}/bookings/${futureBooking1._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 200) && data.success && data.data?.status === 'CANCELLED';

    // Kiểm tra slot đã được giải phóng
    const availRes = await fetch(`${BASE_URL}/bookings/availability?courtId=${court1._id}&bookingDate=${futureStr}`).then(r => r.json());
    const slot08 = (availRes.data?.slots || []).find(s => s.startTime === '08:00');
    const isReleased = slot08 && slot08.isAvailable === true;

    record(5, 'Hủy đơn PENDING_APPROVAL trước giờ chơi', passed && isReleased, `Status: ${res.status}, BookingStatus: ${data.data?.status}, Slot đã giải phóng: ${isReleased}`);
  } catch (err) {
    record(5, 'Hủy đơn PENDING_APPROVAL trước giờ chơi', false, err.message);
  }

  // TEST 6: Hủy đơn CONFIRMED trước giờ chơi -> Cho phép & giải phóng sân
  let confirmedBooking = null;
  try {
    // 6a. Tạo đơn tương lai
    const createRes = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: futureStr,
            startTime: '10:00',
            endTime: '11:00'
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 6 - Sẽ confirm rồi hủy'
      })
    }).then(r => r.json());

    confirmedBooking = createRes.data;

    // 6b. Admin duyệt sang CONFIRMED
    await fetch(`${BASE_URL}/bookings/${confirmedBooking._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });

    // 6c. Khách hàng hủy đơn CONFIRMED trước giờ chơi
    const cancelRes = await fetch(`${BASE_URL}/bookings/${confirmedBooking._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = (cancelRes.status === 200) && cancelData.success && cancelData.data?.status === 'CANCELLED';

    // Kiểm tra slot đã giải phóng
    const availRes = await fetch(`${BASE_URL}/bookings/availability?courtId=${court1._id}&bookingDate=${futureStr}`).then(r => r.json());
    const slot10 = (availRes.data?.slots || []).find(s => s.startTime === '10:00');
    const isReleased = slot10 && slot10.isAvailable === true;

    record(6, 'Hủy đơn CONFIRMED trước giờ chơi', passed && isReleased, `Status: ${cancelRes.status}, BookingStatus: ${cancelData.data?.status}, Slot đã giải phóng: ${isReleased}`);
  } catch (err) {
    record(6, 'Hủy đơn CONFIRMED trước giờ chơi', false, err.message);
  }

  // Kết nối database để tạo các bản ghi mock cho các tình huống vi phạm (Test 7, 8, 9, 11)
  await mongoose.connect('mongodb://localhost:27017/bad2');
  const BookingModel = mongoose.model('BookingTest', new mongoose.Schema({}, { strict: false }), 'Booking');
  const CustomerModel = mongoose.model('CustomerTest', new mongoose.Schema({}, { strict: false }), 'Customer');
  const customerDoc = await CustomerModel.findOne({ email: 'customer@gmail.com' });

  // TEST 7: Hủy đơn đúng giờ bắt đầu (startsAt <= now) -> Từ chối
  try {
    const pastBookingDoc = await BookingModel.create({
      bookingCode: 'TEST_PAST_START_' + Date.now().toString().slice(-6),
      customerId: customerDoc._id,
      courtId: court1._id,
      bookingDate: new Date(todayStr),
      startTime: currentTimeStr,
      endTime: test3End,
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID',
      items: [
        {
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: new Date(todayStr),
          startTime: currentTimeStr,
          endTime: test3End,
          price: 100000,
          status: 'ACTIVE'
        }
      ]
    });

    const res = await fetch(`${BASE_URL}/bookings/${pastBookingDoc._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 409 || res.status === 400) && !data.success && (data.message.includes('thời gian bắt đầu') || data.message.includes('vượt quá'));
    record(7, 'Hủy đơn đúng giờ bắt đầu', passed, `Status: ${res.status}, Message: "${data.message}"`);
    await BookingModel.findByIdAndDelete(pastBookingDoc._id);
  } catch (err) {
    record(7, 'Hủy đơn đúng giờ bắt đầu', false, err.message);
  }

  // TEST 8: Hủy đơn sau giờ bắt đầu (quá khứ) -> Từ chối
  try {
    const pastBookingDoc = await BookingModel.create({
      bookingCode: 'TEST_PAST_DATE_' + Date.now().toString().slice(-6),
      customerId: customerDoc._id,
      courtId: court1._id,
      bookingDate: new Date(yesterdayStr),
      startTime: '08:00',
      endTime: '09:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID',
      items: [
        {
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: new Date(yesterdayStr),
          startTime: '08:00',
          endTime: '09:00',
          price: 100000,
          status: 'ACTIVE'
        }
      ]
    });

    const res = await fetch(`${BASE_URL}/bookings/${pastBookingDoc._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 409 || res.status === 400) && !data.success && (data.message.includes('thời gian bắt đầu') || data.message.includes('vượt quá'));
    record(8, 'Hủy đơn sau giờ bắt đầu', passed, `Status: ${res.status}, Message: "${data.message}"`);
    await BookingModel.findByIdAndDelete(pastBookingDoc._id);
  } catch (err) {
    record(8, 'Hủy đơn sau giờ bắt đầu', false, err.message);
  }

  // TEST 9: Hủy đơn đã hoàn thành (hoặc CHECKED_IN) -> Từ chối
  try {
    const checkedInDoc = await BookingModel.create({
      bookingCode: 'TEST_CHECKED_IN_' + Date.now().toString().slice(-6),
      customerId: customerDoc._id,
      courtId: court1._id,
      bookingDate: new Date(futureStr),
      startTime: '14:00',
      endTime: '15:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CHECKED_IN',
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID',
      items: [
        {
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: new Date(futureStr),
          startTime: '14:00',
          endTime: '15:00',
          price: 100000,
          status: 'ACTIVE'
        }
      ]
    });

    const res = await fetch(`${BASE_URL}/bookings/${checkedInDoc._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 409 || res.status === 400) && !data.success && (data.message.includes('nhận sân') || data.message.includes('sử dụng'));
    record(9, 'Hủy đơn đã CHECKED_IN/bắt đầu chơi', passed, `Status: ${res.status}, Message: "${data.message}"`);
    await BookingModel.findByIdAndDelete(checkedInDoc._id);
  } catch (err) {
    record(9, 'Hủy đơn đã CHECKED_IN/bắt đầu chơi', false, err.message);
  }

  // TEST 10: Hủy đơn đã CANCELLED -> Từ chối
  try {
    const res = await fetch(`${BASE_URL}/bookings/${futureBooking1._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 409 || res.status === 400) && !data.success && data.message.includes('đã được hủy');
    record(10, 'Hủy đơn đã CANCELLED', passed, `Status: ${res.status}, Message: "${data.message}"`);
  } catch (err) {
    record(10, 'Hủy đơn đã CANCELLED', false, err.message);
  }

  // TEST 11: Gửi API hủy trái điều kiện (Backend từ chối)
  try {
    const completedDoc = await BookingModel.create({
      bookingCode: 'TEST_COMPLETED_' + Date.now().toString().slice(-6),
      customerId: customerDoc._id,
      courtId: court1._id,
      bookingDate: new Date(futureStr),
      startTime: '16:00',
      endTime: '17:00',
      price: 100000,
      totalAmount: 100000,
      status: 'COMPLETED',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      items: [
        {
          courtId: court1._id,
          courtName: court1.courtName,
          bookingDate: new Date(futureStr),
          startTime: '16:00',
          endTime: '17:00',
          price: 100000,
          status: 'ACTIVE'
        }
      ]
    });

    const res = await fetch(`${BASE_URL}/bookings/${completedDoc._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const data = await res.json();
    const passed = (res.status === 409 || res.status === 400) && !data.success && (data.message.includes('hoàn thành') || data.message.includes('Không thể'));
    record(11, 'Gửi API hủy trái điều kiện (Backend từ chối)', passed, `Status: ${res.status}, Message: "${data.message}"`);
    await BookingModel.findByIdAndDelete(completedDoc._id);
  } catch (err) {
    record(11, 'Gửi API hủy trái điều kiện (Backend từ chối)', false, err.message);
  }

  // TEST 12: Hủy Booking nhiều sân (đồng bộ đúng các sân và khung giờ)
  try {
    const createRes = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        courtOrders: [
          {
            courtId: court1._id,
            bookingDate: futureStr,
            startTime: '18:00',
            endTime: '19:00'
          },
          {
            courtId: court2._id,
            bookingDate: futureStr,
            startTime: '18:00',
            endTime: '19:00'
          }
        ],
        paymentMethod: 'CASH',
        note: 'Test 12 - Multi-court booking'
      })
    }).then(r => r.json());

    const multiBooking = createRes.data;
    const item1 = multiBooking.items.find(it => String(it.courtId._id || it.courtId) === String(court1._id));
    const item2 = multiBooking.items.find(it => String(it.courtId._id || it.courtId) === String(court2._id));

    // Hủy duy nhất item1 (court1)
    const cancelItemRes = await fetch(`${BASE_URL}/bookings/${multiBooking._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        status: 'CANCELLED',
        itemId: item1._id
      })
    });
    const cancelItemData = await cancelItemRes.json();

    const updatedBooking = cancelItemData.data;
    const updItem1 = updatedBooking.items.find(it => String(it._id) === String(item1._id));
    const updItem2 = updatedBooking.items.find(it => String(it._id) === String(item2._id));

    const avail1 = await fetch(`${BASE_URL}/bookings/availability?courtId=${court1._id}&bookingDate=${futureStr}`).then(r => r.json());
    const avail2 = await fetch(`${BASE_URL}/bookings/availability?courtId=${court2._id}&bookingDate=${futureStr}`).then(r => r.json());

    const slotCourt1 = (avail1.data?.slots || []).find(s => s.startTime === '18:00');
    const slotCourt2 = (avail2.data?.slots || []).find(s => s.startTime === '18:00');

    const item1Cancelled = updItem1.status === 'CANCELLED';
    const item2Active = updItem2.status === 'ACTIVE';
    const court1Released = slotCourt1 && slotCourt1.isAvailable === true;
    const court2StillBooked = slotCourt2 && slotCourt2.isAvailable === false;
    const bookingNotCancelled = updatedBooking.status !== 'CANCELLED';

    const passed = item1Cancelled && item2Active && court1Released && court2StillBooked && bookingNotCancelled;

    record(12, 'Hủy Booking nhiều sân (chỉ giải phóng đúng sân hủy, giữ nguyên sân còn lại)', passed,
      `BookingStatus: ${updatedBooking.status}, Item1: ${updItem1.status}, Item2: ${updItem2.status}, Court1 released: ${court1Released}, Court2 still booked: ${court2StillBooked}`);

    await BookingModel.findByIdAndDelete(multiBooking._id);
  } catch (err) {
    record(12, 'Hủy Booking nhiều sân', false, err.message);
  }

  // Dọn dẹp booking test
  if (futureBooking1) await BookingModel.findByIdAndDelete(futureBooking1._id);
  if (confirmedBooking) await BookingModel.findByIdAndDelete(confirmedBooking._id);
  await mongoose.disconnect();

  console.log('================================================================');
  console.log('=== KẾT QUẢ TỔNG HỢP KIỂM THỬ 12 BUSINESS RULES ===');
  console.log('================================================================');
  const allPassed = results.every(r => r.passed);
  console.log(`Tổng số test case: ${results.length}`);
  console.log(`Số test case đạt: ${results.filter(r => r.passed).length}/${results.length}`);
  console.log(`Đánh giá chung: ${allPassed ? '✅ TOÀN BỘ 12 TÌNH HUỐNG ĐẠT CHUẨN (100% PASS)' : '❌ CÓ TEST CASE THẤT BẠI'}\n`);
}

runTests().catch(err => {
  console.error('Lỗi thực thi test:', err);
  process.exit(1);
});
