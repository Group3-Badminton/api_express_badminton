const fetch = globalThis.fetch;
const mongoose = require('mongoose');

const BASE_URL = 'http://127.0.0.1:9999/api';

async function runTests() {
  console.log('====================================================================');
  console.log('=== TEST SUITE: 14 TEST CASES BOOKING CANCELLATION & MONGODB SYNC ===');
  console.log('====================================================================\n');

  // Kết nối MongoDB để chuẩn bị dữ liệu test
  await mongoose.connect('mongodb://localhost:27017/bad2');
  const CourtModel = mongoose.model('CourtM', new mongoose.Schema({}, { strict: false }), 'Court');
  const BookingModel = mongoose.model('BookingM', new mongoose.Schema({}, { strict: false }), 'Booking');
  const CustomerModel = mongoose.model('CustomerM', new mongoose.Schema({}, { strict: false }), 'Customer');

  // Mở khóa tài khoản trước khi đăng nhập
  await CustomerModel.updateMany(
    { email: { $in: ['customer@gmail.com', 'long.le@gmail.com'] } },
    {
      $set: { status: 'ACTIVE', bookingCancellationHistory: [] },
      $unset: { lockReason: 1, lockedAt: 1, lockedByBookingId: 1, cancellationLockToken: 1, cancellationLockUntil: 1 }
    }
  );

  // Đăng nhập các tài khoản
  console.log('[Setup] Đăng nhập các tài khoản...');
  const custRes1 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'customer@gmail.com', password: '123456' })
  }).then(r => r.json());
  const tokenCust1 = custRes1.data?.token;

  const custRes2 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'long.le@gmail.com', password: '123456' })
  }).then(r => r.json());
  const tokenCust2 = custRes2.data?.token;

  const adminRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@gmail.com', password: '123456' })
  }).then(r => r.json());
  const tokenAdmin = adminRes.data?.token;

  if (!tokenCust1 || !tokenCust2 || !tokenAdmin) {
    throw new Error('Đăng nhập thất bại: vui lòng kiểm tra tài khoản!');
  }
  console.log('  Customer 1 Token: OK');
  console.log('  Customer 2 Token: OK');
  console.log('  Admin Token: OK\n');

  const courts = await CourtModel.find({ status: 'ACTIVE' }).lean();
  if (courts.length < 3) throw new Error('Cần ít nhất 3 sân thi đấu trong DB!');
  const court1 = courts[0];
  const court2 = courts[1];
  const court3 = courts[2];
  await CourtModel.updateMany(
    { _id: { $in: [court1._id, court2._id, court3._id] } },
    { $set: { operationalStatus: 'AVAILABLE' } }
  );
  console.log(`[Setup] Sân thi đấu: [1] ${court1.courtName}, [2] ${court2.courtName}, [3] ${court3.courtName}\n`);

  // Tính các mốc ngày (Giờ VN: UTC+7)
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;

  const yesterdayDate = new Date(vnNow.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = `${yesterdayDate.getUTCFullYear()}-${pad(yesterdayDate.getUTCMonth() + 1)}-${pad(yesterdayDate.getUTCDate())}`;

  const futureDate = new Date(vnNow.getTime() + 5 * 24 * 60 * 60 * 1000);
  const futureStr = `${futureDate.getUTCFullYear()}-${pad(futureDate.getUTCMonth() + 1)}-${pad(futureDate.getUTCDate())}`;

  const currentHour = vnNow.getUTCHours();
  const currentMinute = vnNow.getUTCMinutes();
  const currentTimeStr = `${pad(currentHour)}:${pad(currentMinute)}`;
  const nextHourStr = `${pad((currentHour + 1) % 24)}:00`;

  const results = [];
  function record(stt, title, passed, details) {
    results.push({ stt, title, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[Test ${stt}] ${mark}: ${title}`);
    console.log(`   Chi tiết: ${details}\n`);
  }

  const createdBookingIds = [];

  async function ensureCustomerActive() {
    await CustomerModel.updateOne(
      { email: 'customer@gmail.com' },
      {
        $set: { status: 'ACTIVE', bookingCancellationHistory: [] },
        $unset: { lockReason: 1, lockedAt: 1, lockedByBookingId: 1, cancellationLockToken: 1, cancellationLockUntil: 1 }
      }
    );
  }

  // =========================================================================
  // TEST 1: Hủy Booking trước giờ chơi -> Thành công
  // =========================================================================
  let b1;
  try {
    await ensureCustomerActive();
    const createRes = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({
        courtOrders: [{ courtId: court1._id, bookingDate: futureStr, startTime: '08:00', endTime: '09:00' }],
        paymentMethod: 'CASH',
        note: 'Test 1 - Trước giờ chơi'
      })
    }).then(r => r.json());
    b1 = createRes.data;
    createdBookingIds.push(b1._id);

    const cancelRes = await fetch(`${BASE_URL}/bookings/${b1._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = cancelRes.status === 200 && cancelData.data?.status === 'CANCELLED';
    record(1, 'Hủy Booking trước giờ chơi', passed, `Status: ${cancelRes.status}, BookingStatus: ${cancelData.data?.status}`);
  } catch (err) {
    record(1, 'Hủy Booking trước giờ chơi', false, err.message);
  }

  // =========================================================================
  // TEST 2: Hủy Booking đúng giờ nhưng chưa chơi -> Thành công
  // =========================================================================
  let b2;
  try {
    await ensureCustomerActive();
    // Đơn có thời gian bắt đầu là thời điểm hiện tại nhưng sân chưa check-in (AVAILABLE)
    const custDoc1 = await CustomerModel.findOne({ email: 'customer@gmail.com' });
    const doc2 = await BookingModel.create({
      bookingCode: 'BK_DUNG_GIO_' + Date.now().toString().slice(-6),
      customerId: custDoc1._id,
      courtId: court1._id,
      bookingDate: new Date(todayStr),
      startTime: currentTimeStr,
      endTime: nextHourStr,
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      items: [{
        courtId: court1._id,
        courtName: court1.courtName,
        bookingDate: new Date(todayStr),
        startTime: currentTimeStr,
        endTime: nextHourStr,
        price: 100000,
        status: 'ACTIVE'
      }]
    });
    b2 = doc2;
    createdBookingIds.push(b2._id);

    const cancelRes = await fetch(`${BASE_URL}/bookings/${b2._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = cancelRes.status === 200 && cancelData.data?.status === 'CANCELLED';
    record(2, 'Hủy Booking đúng giờ nhưng chưa chơi', passed, `Status: ${cancelRes.status}, BookingStatus: ${cancelData.data?.status}`);
  } catch (err) {
    record(2, 'Hủy Booking đúng giờ nhưng chưa chơi', false, err.message);
  }

  // =========================================================================
  // TEST 3: Hủy Booking quá giờ nhưng chưa chơi -> Thành công
  // =========================================================================
  let b3;
  try {
    await ensureCustomerActive();
    // Đơn có ngày hôm qua (quá giờ) nhưng chưa từng check-in (chưa chơi)
    const custDoc1 = await CustomerModel.findOne({ email: 'customer@gmail.com' });
    const doc3 = await BookingModel.create({
      bookingCode: 'BK_QUA_GIO_' + Date.now().toString().slice(-6),
      customerId: custDoc1._id,
      courtId: court1._id,
      bookingDate: new Date(yesterdayStr),
      startTime: '08:00',
      endTime: '09:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      items: [{
        courtId: court1._id,
        courtName: court1.courtName,
        bookingDate: new Date(yesterdayStr),
        startTime: '08:00',
        endTime: '09:00',
        price: 100000,
        status: 'ACTIVE'
      }]
    });
    b3 = doc3;
    createdBookingIds.push(b3._id);

    const cancelRes = await fetch(`${BASE_URL}/bookings/${b3._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = cancelRes.status === 200 && cancelData.data?.status === 'CANCELLED';
    record(3, 'Hủy Booking quá giờ nhưng chưa chơi', passed, `Status: ${cancelRes.status}, BookingStatus: ${cancelData.data?.status}`);
  } catch (err) {
    record(3, 'Hủy Booking quá giờ nhưng chưa chơi', false, err.message);
  }

  // =========================================================================
  // TEST 4: Hủy Booking khi sân IN_USE -> Từ chối
  // =========================================================================
  let b4;
  try {
    await ensureCustomerActive();
    const custDoc1 = await CustomerModel.findOne({ email: 'customer@gmail.com' });
    const doc4 = await BookingModel.create({
      bookingCode: 'BK_IN_USE_' + Date.now().toString().slice(-6),
      customerId: custDoc1._id,
      courtId: court1._id,
      bookingDate: new Date(todayStr),
      startTime: '10:00',
      endTime: '11:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      items: [{
        courtId: court1._id,
        courtName: court1.courtName,
        bookingDate: new Date(todayStr),
        startTime: '10:00',
        endTime: '11:00',
        price: 100000,
        status: 'ACTIVE'
      }]
    });
    b4 = doc4;
    createdBookingIds.push(b4._id);

    // Đánh dấu sân 1 là IN_USE trong MongoDB
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'IN_USE' } });

    const cancelRes = await fetch(`${BASE_URL}/bookings/${b4._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = cancelRes.status === 409 && cancelData.message.includes('Sân đang được sử dụng, không thể hủy sân này.');
    record(4, 'Hủy Booking khi sân IN_USE (Từ chối)', passed, `Status: ${cancelRes.status}, Message: "${cancelData.message}"`);
  } catch (err) {
    record(4, 'Hủy Booking khi sân IN_USE (Từ chối)', false, err.message);
  } finally {
    // Khôi phục trạng thái sân 1
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'AVAILABLE' } });
  }

  // =========================================================================
  // TEST 5: Hủy Booking đã CANCELLED -> Từ chối
  // =========================================================================
  try {
    await ensureCustomerActive();
    const cancelRes = await fetch(`${BASE_URL}/bookings/${b1._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const passed = cancelRes.status === 409 && cancelData.message.includes('đã được hủy');
    record(5, 'Hủy Booking đã CANCELLED (Từ chối)', passed, `Status: ${cancelRes.status}, Message: "${cancelData.message}"`);
  } catch (err) {
    record(5, 'Hủy Booking đã CANCELLED (Từ chối)', false, err.message);
  }

  // =========================================================================
  // TEST 6: Hủy một sân trong Booking nhiều sân -> Chỉ hủy sân được chọn
  // =========================================================================
  let b6;
  try {
    await ensureCustomerActive();
    const createRes = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({
        courtOrders: [
          { courtId: court1._id, bookingDate: futureStr, startTime: '14:00', endTime: '15:00' },
          { courtId: court2._id, bookingDate: futureStr, startTime: '14:00', endTime: '15:00' }
        ],
        paymentMethod: 'CASH',
        note: 'Test 6 - Hủy 1 sân trong 2 sân'
      })
    }).then(r => r.json());
    b6 = createRes.data;
    createdBookingIds.push(b6._id);

    const itemCourt1 = b6.items.find(it => String(it.courtId._id || it.courtId) === String(court1._id));
    const itemCourt2 = b6.items.find(it => String(it.courtId._id || it.courtId) === String(court2._id));

    // Hủy chỉ item sân 1
    const cancelRes = await fetch(`${BASE_URL}/bookings/${b6._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED', itemId: itemCourt1._id })
    });
    const cancelData = await cancelRes.json();
    const updated = cancelData.data;

    const it1Status = updated.items.find(i => String(i._id) === String(itemCourt1._id))?.status;
    const it2Status = updated.items.find(i => String(i._id) === String(itemCourt2._id))?.status;
    const bookingNotCancelled = updated.status !== 'CANCELLED';

    const passed = cancelRes.status === 200 && it1Status === 'CANCELLED' && it2Status === 'ACTIVE' && bookingNotCancelled;
    record(6, 'Hủy một sân trong Booking nhiều sân', passed, `Item 1: ${it1Status}, Item 2: ${it2Status}, Booking: ${updated.status}`);
  } catch (err) {
    record(6, 'Hủy một sân trong Booking nhiều sân', false, err.message);
  }

  // =========================================================================
  // TEST 7: Một sân IN_USE, hai sân chưa chơi -> Hủy được hai sân chưa chơi
  // =========================================================================
  let b7;
  try {
    await ensureCustomerActive();
    const createRes = await fetch(`${BASE_URL}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({
        courtOrders: [
          { courtId: court1._id, bookingDate: futureStr, startTime: '16:00', endTime: '17:00' },
          { courtId: court2._id, bookingDate: futureStr, startTime: '16:00', endTime: '17:00' },
          { courtId: court3._id, bookingDate: futureStr, startTime: '16:00', endTime: '17:00' }
        ],
        paymentMethod: 'CASH',
        note: 'Test 7 - 3 sân'
      })
    }).then(r => r.json());
    b7 = createRes.data;
    createdBookingIds.push(b7._id);

    // Đánh dấu sân 1 là IN_USE trong MongoDB, sân 2 và 3 vẫn AVAILABLE
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'IN_USE' } });
    await CourtModel.updateMany({ _id: { $in: [court2._id, court3._id] } }, { $set: { operationalStatus: 'AVAILABLE' } });

    // Khách hàng gửi yêu cầu hủy đơn (không chỉ định itemId -> Hủy toàn bộ đơn)
    const cancelRes = await fetch(`${BASE_URL}/bookings/${b7._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const cancelData = await cancelRes.json();
    const updated = cancelData.data;

    const it1Status = updated.items.find(i => String(i.courtId._id || i.courtId) === String(court1._id))?.status;
    const it2Status = updated.items.find(i => String(i.courtId._id || i.courtId) === String(court2._id))?.status;
    const it3Status = updated.items.find(i => String(i.courtId._id || i.courtId) === String(court3._id))?.status;

    // Sân 1 đang IN_USE nên không được hủy (vẫn ACTIVE), Sân 2 và Sân 3 chưa chơi nên được hủy (CANCELLED)
    const passed = cancelRes.status === 200 && it1Status === 'ACTIVE' && it2Status === 'CANCELLED' && it3Status === 'CANCELLED';
    record(7, 'Một sân IN_USE, hai sân chưa chơi (Hủy được 2 sân chưa chơi)', passed,
      `Sân 1 (IN_USE): ${it1Status}, Sân 2: ${it2Status}, Sân 3: ${it3Status}, TotalAmount còn lại: ${updated.totalAmount}đ`);
  } catch (err) {
    record(7, 'Một sân IN_USE, hai sân chưa chơi (Hủy được 2 sân chưa chơi)', false, err.message);
  } finally {
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'AVAILABLE' } });
  }

  // =========================================================================
  // TEST 8: Hủy sân thành công -> Giải phóng khung giờ
  // =========================================================================
  try {
    // Sân 2 ở Test 7 (khung giờ 16:00 ngày futureStr) đã hủy -> Phải giải phóng slot
    const availRes = await fetch(`${BASE_URL}/bookings/availability?courtId=${court2._id}&bookingDate=${futureStr}`).then(r => r.json());
    const slot16 = (availRes.data?.slots || []).find(s => s.startTime === '16:00');
    const isReleased = slot16 && slot16.isAvailable === true;
    record(8, 'Hủy sân thành công -> Giải phóng khung giờ', isReleased, `Slot 16:00 Sân 2 isAvailable: ${isReleased}`);
  } catch (err) {
    record(8, 'Hủy sân thành công -> Giải phóng khung giờ', false, err.message);
  }

  // =========================================================================
  // TEST 9: Hủy sân thành công -> MongoDB cập nhật CANCELLED
  // =========================================================================
  try {
    const docB1 = await BookingModel.findById(b1._id).lean();
    const passed = docB1.status === 'CANCELLED' && (docB1.items || []).every(i => i.status === 'CANCELLED');
    record(9, 'Hủy sân thành công -> MongoDB cập nhật CANCELLED', passed, `MongoDB Booking status: ${docB1.status}`);
  } catch (err) {
    record(9, 'Hủy sân thành công -> MongoDB cập nhật CANCELLED', false, err.message);
  }

  // =========================================================================
  // TEST 10: Reload trang sau khi hủy -> Trạng thái vẫn chính xác
  // =========================================================================
  try {
    await ensureCustomerActive();
    const fetchRes = await fetch(`${BASE_URL}/bookings/${b1._id}`, {
      headers: { Authorization: `Bearer ${tokenCust1}` }
    }).then(r => r.json());
    const passed = fetchRes.success && fetchRes.data?.status === 'CANCELLED';
    record(10, 'Reload trang sau khi hủy (Đọc lại dữ liệu thực tế từ MongoDB)', passed, `Status: ${fetchRes.data?.status}`);
  } catch (err) {
    record(10, 'Reload trang sau khi hủy (Đọc lại dữ liệu thực tế từ MongoDB)', false, err.message);
  }

  // =========================================================================
  // TEST 11: Admin kiểm tra Booking -> Nhìn thấy trạng thái mới
  // =========================================================================
  try {
    const adminFetchRes = await fetch(`${BASE_URL}/bookings/${b1._id}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    }).then(r => r.json());
    const passed = adminFetchRes.success && adminFetchRes.data?.status === 'CANCELLED';
    record(11, 'Admin kiểm tra Booking -> Nhìn thấy trạng thái CANCELLED', passed, `Admin view status: ${adminFetchRes.data?.status}`);
  } catch (err) {
    record(11, 'Admin kiểm tra Booking -> Nhìn thấy trạng thái CANCELLED', false, err.message);
  }

  // =========================================================================
  // TEST 12: Gửi API trực tiếp khi sân IN_USE -> Backend từ chối
  // =========================================================================
  try {
    await ensureCustomerActive();
    const custDoc1 = await CustomerModel.findOne({ email: 'customer@gmail.com' });
    const doc12 = await BookingModel.create({
      bookingCode: 'BK_DIRECT_IN_USE_' + Date.now().toString().slice(-6),
      customerId: custDoc1._id,
      courtId: court1._id,
      bookingDate: new Date(futureStr),
      startTime: '21:00',
      endTime: '22:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      items: [{
        courtId: court1._id,
        courtName: court1.courtName,
        bookingDate: new Date(futureStr),
        startTime: '21:00',
        endTime: '22:00',
        price: 100000,
        status: 'ACTIVE'
      }]
    });
    createdBookingIds.push(doc12._id);

    // Sân 1 đang IN_USE, gửi request API hủy trực tiếp
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'IN_USE' } });
    const directRes = await fetch(`${BASE_URL}/bookings/${doc12._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const directData = await directRes.json();
    const passed = directRes.status === 409 && directData.message === 'Sân đang được sử dụng, không thể hủy sân này.';
    record(12, 'Gửi API trực tiếp khi sân IN_USE -> Backend từ chối', passed, `Status: ${directRes.status}, Message: "${directData.message}"`);
  } catch (err) {
    record(12, 'Gửi API trực tiếp khi sân IN_USE -> Backend từ chối', false, err.message);
  } finally {
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'AVAILABLE' } });
  }

  // =========================================================================
  // TEST 13: Hai request hủy và bắt đầu chơi đồng thời -> Trạng thái nhất quán
  // =========================================================================
  try {
    await ensureCustomerActive();
    // Tạo booking thử nghiệm
    const custDoc1 = await CustomerModel.findOne({ email: 'customer@gmail.com' });
    const doc13 = await BookingModel.create({
      bookingCode: 'BK_RACE_' + Date.now().toString().slice(-6),
      customerId: custDoc1._id,
      courtId: court1._id,
      bookingDate: new Date(futureStr),
      startTime: '19:00',
      endTime: '20:00',
      price: 100000,
      totalAmount: 100000,
      status: 'CONFIRMED',
      items: [{
        courtId: court1._id,
        courtName: court1.courtName,
        bookingDate: new Date(futureStr),
        startTime: '19:00',
        endTime: '20:00',
        price: 100000,
        status: 'ACTIVE'
      }]
    });
    createdBookingIds.push(doc13._id);

    // Giả lập đồng thời: Nhân viên set court1 operationalStatus = IN_USE và Khách gọi API hủy
    const [courtUpdateRes, cancelReqRes] = await Promise.all([
      CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'IN_USE' } }),
      fetch(`${BASE_URL}/bookings/${doc13._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust1}` },
        body: JSON.stringify({ status: 'CANCELLED' })
      }).then(r => r.json())
    ]);

    // Backend phát hiện sân IN_USE và từ chối hủy, không cho phép hủy đè lên sân đang chơi
    const passed = cancelReqRes.success === false && cancelReqRes.message.includes('Sân đang được sử dụng');
    record(13, 'Hai request hủy và bắt đầu chơi đồng thời -> Không xảy ra bất nhất', passed,
      `Result: ${cancelReqRes.message}`);
  } catch (err) {
    record(13, 'Hai request hủy và bắt đầu chơi đồng thời -> Không xảy ra bất nhất', false, err.message);
  } finally {
    await CourtModel.updateOne({ _id: court1._id }, { $set: { operationalStatus: 'AVAILABLE' } });
  }

  // =========================================================================
  // TEST 14: Hủy Booking của khách hàng khác -> Backend từ chối
  // =========================================================================
  try {
    // Customer 2 cố gắng gửi request hủy booking của Customer 1 (b7)
    const hackRes = await fetch(`${BASE_URL}/bookings/${b7._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCust2}` },
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    const hackData = await hackRes.json();
    const passed = hackRes.status === 403 && hackData.message.includes('không có quyền');
    record(14, 'Hủy Booking của khách hàng khác -> Backend từ chối (403)', passed, `Status: ${hackRes.status}, Message: "${hackData.message}"`);
  } catch (err) {
    record(14, 'Hủy Booking của khách hàng khác -> Backend từ chối (403)', false, err.message);
  }

  // =========================================================================
  // Dọn dẹp dữ liệu test
  // =========================================================================
  await BookingModel.deleteMany({ _id: { $in: createdBookingIds } });
  await mongoose.disconnect();

  console.log('====================================================================');
  console.log('=== KẾT QUẢ TỔNG HỢP KIỂM THỬ 14 TEST CASES ===');
  console.log('====================================================================');
  const allPassed = results.every(r => r.passed);
  console.log(`Tổng số test case: ${results.length}`);
  console.log(`Số test case đạt: ${results.filter(r => r.passed).length}/${results.length}`);
  console.log(`Đánh giá chung: ${allPassed ? '✅ TOÀN BỘ 14 TEST CASE ĐẠT CHUẨN 100%' : '❌ CÓ TEST CASE THẤT BẠI'}\n`);
}

runTests().catch(err => {
  console.error('Lỗi thực thi test suite:', err);
  process.exit(1);
});
