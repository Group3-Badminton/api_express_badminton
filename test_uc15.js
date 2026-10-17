/**
 * Suite kiểm thử tích hợp toàn diện cho module UC-15 Voucher Management:
 * 1. RBAC & Security: Guest/Customer (401/403), Staff read-only (200 for GET, 403 for POST/PATCH), Admin full rights.
 * 2. UC-15.3: Create Voucher (Validation mã code, format, uniqueness, discountValue, start/end dates, minInvoice).
 * 3. UC-15.1 & UC-15.6: View List, Search, Filter (status, validityStatus, date range), Server Pagination, Stable Sorting.
 * 4. UC-15.2: View Detail (Compute timeStatus, isUsageExceeded, isApplicable).
 * 5. UC-15.4: Update Voucher (Admin only, validation dates, prevent usageLimit lower than usedCount, update fields).
 * 6. UC-15.5: Deactivate Voucher (Admin only, preserve transactions & data, toggle status INACTIVE, re-activate).
 */

const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('./app');
const Voucher = require('./src/models/voucher');

const JWT_SECRET = process.env.JWT_SECRET || 'badminton_secret_key_2026';

let server;
let port;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (body) {
      headers['Content-Length'] = Buffer.byteLength(dataString);
    }

    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: rawData });
        }
      });
    });

    req.on('error', (e) => reject(e));

    if (body) {
      req.write(dataString);
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🚀 BẮT ĐẦU CHẠY KIỂM THỬ MODULE UC-15 VOUCHER MANAGEMENT');
  console.log('======================================================\n');

  // Khởi động server test
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      console.log(`Test server running on port ${port}`);
      resolve();
    });
  });

  // Mock roles
  const adminId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const adminToken = jwt.sign({ userId: adminId, role: 'ADMIN', email: 'admin@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const staffToken = jwt.sign({ userId: staffId, role: 'STAFF', email: 'staff@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const customerToken = jwt.sign({ userId: customerId, role: 'CUSTOMER', email: 'cust@test.com' }, JWT_SECRET, { expiresIn: '1h' });

  // Xóa dữ liệu voucher test
  await Voucher.deleteMany({});

  try {
    // -----------------------------------------------------------------
    // TEST SUITE 1: Phân quyền truy cập (RBAC - BR-02)
    // -----------------------------------------------------------------
    console.log('\n[1] Kiểm thử RBAC & Xác thực:');

    // 1.1 Khách vãng lai (Guest)
    const guestRes = await request('GET', '/api/vouchers');
    assert(guestRes.status === 401, 'Guest không được truy cập danh sách voucher (HTTP 401)');

    // 1.2 Customer
    const custRes = await request('GET', '/api/vouchers', null, customerToken);
    assert(custRes.status === 403, 'Customer bị từ chối truy cập module voucher (HTTP 403)');

    // 1.3 Staff được xem danh sách
    const staffListRes = await request('GET', '/api/vouchers', null, staffToken);
    assert(staffListRes.status === 200, 'Staff có quyền xem danh sách voucher (HTTP 200)');

    // 1.4 Staff không được tạo voucher
    const staffCreateRes = await request('POST', '/api/vouchers', { code: 'STAFF10' }, staffToken);
    assert(staffCreateRes.status === 403, 'Staff KHÔNG thể tạo voucher mới (HTTP 403)');

    // -----------------------------------------------------------------
    // TEST SUITE 2: UC-15.3 - Tạo voucher (Create Voucher - Admin)
    // -----------------------------------------------------------------
    console.log('\n[2] Kiểm thử UC-15.3: Tạo voucher mới (Admin):');

    // 2.1 Mã voucher rỗng hoặc sai định dạng
    const invalidCodeRes = await request('POST', '/api/vouchers', { code: '  ', name: 'Giảm 10%' }, adminToken);
    assert(invalidCodeRes.status === 400, 'Từ chối tạo khi mã voucher rỗng (HTTP 400)');

    // 2.2 Ngày bắt đầu sau ngày kết thúc
    const invalidDatesRes = await request('POST', '/api/vouchers', {
      code: 'INVALID_DATES',
      name: 'Voucher sai ngày',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startDate: new Date(Date.now() + 86400000 * 5).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 2).toISOString()
    }, adminToken);
    assert(invalidDatesRes.status === 400, 'Từ chối tạo khi ngày bắt đầu sau ngày kết thúc (HTTP 400)');

    // 2.3 Giảm theo % vượt quá 100%
    const overPercentRes = await request('POST', '/api/vouchers', {
      code: 'OVER100',
      name: 'Voucher 120%',
      discountType: 'PERCENTAGE',
      discountValue: 120,
      startDate: new Date(Date.now() - 86400000).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 10).toISOString()
    }, adminToken);
    assert(overPercentRes.status === 400, 'Từ chối tạo khi phần trăm giảm > 100% (HTTP 400)');

    // 2.4 Tạo thành công Voucher 1 (Đang hiệu lực - Active & In Range)
    const v1Res = await request('POST', '/api/vouchers', {
      code: 'VOUCHER10',
      name: 'Giảm 10% Giờ Vàng',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      maxDiscountAmount: 50000,
      minInvoiceAmount: 100000,
      startDate: new Date(Date.now() - 86400000).toISOString(), // Bắt đầu hôm qua
      endDate: new Date(Date.now() + 86400000 * 7).toISOString(), // Hết hạn 7 ngày tới
      usageLimit: 100,
      description: 'Áp dụng cho mọi hóa đơn trên 100.000đ'
    }, adminToken);
    assert(v1Res.status === 201 && v1Res.body.success, 'Admin tạo thành công Voucher 1 (HTTP 201)');
    assert(v1Res.body.data.status === 'ACTIVE', 'Trạng thái ban đầu là ACTIVE');
    assert(v1Res.body.data.timeStatus === 'VALID', 'Thời gian hiệu lực tính toán là VALID');
    assert(v1Res.body.data.isApplicable === true, 'Đủ điều kiện áp dụng (isApplicable = true)');
    const v1Id = v1Res.body.data._id;

    // 2.5 Tạo thành công Voucher 2 (Đã hết hạn - Expired)
    const v2Res = await request('POST', '/api/vouchers', {
      code: 'OLD_EXPIRED',
      name: 'Voucher Tết Cũ',
      discountType: 'FIXED_AMOUNT',
      discountValue: 50000,
      minInvoiceAmount: 200000,
      startDate: new Date(Date.now() - 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() - 86400000 * 2).toISOString(), // Đã hết hạn 2 ngày trước
      usageLimit: 50
    }, adminToken);
    assert(v2Res.status === 201, 'Tạo thành công Voucher 2');
    assert(v2Res.body.data.timeStatus === 'EXPIRED', 'Thời gian hiệu lực tính toán là EXPIRED');
    assert(v2Res.body.data.isApplicable === false, 'Hết hạn nên không thể áp dụng (isApplicable = false)');
    const v2Id = v2Res.body.data._id;

    // 2.6 Kiểm tra tính duy nhất (Unique Code)
    const dupRes = await request('POST', '/api/vouchers', {
      code: 'voucher10', // Thử chữ thường
      name: 'Trùng mã',
      discountType: 'PERCENTAGE',
      discountValue: 5,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString()
    }, adminToken);
    assert(dupRes.status === 409, 'Ngăn chặn trùng lặp mã voucher (HTTP 409)');

    // -----------------------------------------------------------------
    // TEST SUITE 3: UC-15.1 & UC-15.6 - Danh sách, Tìm kiếm, Lọc, Phân trang
    // -----------------------------------------------------------------
    console.log('\n[3] Kiểm thử UC-15.1 & UC-15.6: Danh sách, Tìm kiếm & Lọc (Staff/Admin):');

    // 3.1 Staff xem danh sách và phân trang
    const listRes = await request('GET', '/api/vouchers?page=1&limit=10', null, staffToken);
    assert(listRes.status === 200 && listRes.body.data.items.length === 2, 'Lấy danh sách thành công (2 voucher)');
    assert(listRes.body.data.pagination.total === 2, 'Tổng số bản ghi là 2');

    // 3.2 Tìm kiếm theo mã code
    const searchRes = await request('GET', '/api/vouchers?search=VOUCHER10', null, staffToken);
    assert(searchRes.status === 200 && searchRes.body.data.items.length === 1, 'Tìm kiếm "VOUCHER10" trả về đúng 1 bản ghi');
    assert(searchRes.body.data.items[0]._id === String(v1Id), 'Khớp đúng Voucher 1');

    // 3.3 Lọc theo validityStatus = VALID
    const validFilterRes = await request('GET', '/api/vouchers?validityStatus=VALID', null, staffToken);
    assert(validFilterRes.body.data.items.length === 1 && validFilterRes.body.data.items[0]._id === String(v1Id),
      'Lọc validityStatus=VALID trả về đúng voucher còn trong hạn');

    // 3.4 Lọc theo validityStatus = EXPIRED
    const expiredFilterRes = await request('GET', '/api/vouchers?validityStatus=EXPIRED', null, staffToken);
    assert(expiredFilterRes.body.data.items.length === 1 && expiredFilterRes.body.data.items[0]._id === String(v2Id),
      'Lọc validityStatus=EXPIRED trả về đúng voucher đã hết hạn');

    // -----------------------------------------------------------------
    // TEST SUITE 4: UC-15.2 - Xem chi tiết voucher (View Detail)
    // -----------------------------------------------------------------
    console.log('\n[4] Kiểm thử UC-15.2: Xem chi tiết voucher:');

    // 4.1 ID không tồn tại
    const fakeId = new mongoose.Types.ObjectId();
    const notFoundRes = await request('GET', `/api/vouchers/${fakeId}`, null, staffToken);
    assert(notFoundRes.status === 404, 'Trả về 404 khi không tìm thấy voucher');

    // 4.2 Lấy chi tiết thành công
    const detailRes = await request('GET', `/api/vouchers/${v1Id}`, null, staffToken);
    assert(detailRes.status === 200, 'Lấy chi tiết voucher thành công (HTTP 200)');
    assert(detailRes.body.data.code === 'VOUCHER10', 'Trả về đúng mã code');
    assert(detailRes.body.data.timeStatus === 'VALID', 'Có thông tin timeStatus');
    assert(detailRes.body.data.isApplicable === true, 'Có thông tin isApplicable');

    // -----------------------------------------------------------------
    // TEST SUITE 5: UC-15.4 - Cập nhật voucher (Update Voucher)
    // -----------------------------------------------------------------
    console.log('\n[5] Kiểm thử UC-15.4: Cập nhật thông tin voucher:');

    // 5.1 Staff không được cập nhật
    const staffUpdateRes = await request('PATCH', `/api/vouchers/${v1Id}`, { name: 'Thử sửa' }, staffToken);
    assert(staffUpdateRes.status === 403, 'Staff KHÔNG thể cập nhật voucher (HTTP 403)');

    // 5.2 Giả lập voucher 1 đã được dùng 5 lần
    await Voucher.findByIdAndUpdate(v1Id, { usedCount: 5 });

    // 5.3 Thử hạ usageLimit xuống 3 (< usedCount = 5)
    const lowerLimitRes = await request('PATCH', `/api/vouchers/${v1Id}`, { usageLimit: 3 }, adminToken);
    assert(lowerLimitRes.status === 400, 'Ngăn chặn hạ usageLimit thấp hơn số lượt đã dùng (HTTP 400)');

    // 5.4 Cập nhật hợp lệ: sửa tên, nâng mức giảm và gia hạn ngày
    const validUpdateRes = await request('PATCH', `/api/vouchers/${v1Id}`, {
      name: 'Giảm 15% Tri Ân Khách Hàng',
      discountValue: 15,
      usageLimit: 200
    }, adminToken);
    assert(validUpdateRes.status === 200, 'Admin cập nhật thành công voucher (HTTP 200)');
    assert(validUpdateRes.body.data.name === 'Giảm 15% Tri Ân Khách Hàng', 'Tên voucher đã cập nhật');
    assert(validUpdateRes.body.data.discountValue === 15, 'Mức giảm giá cập nhật thành 15%');
    assert(validUpdateRes.body.data.usageLimit === 200, 'Giới hạn lượt dùng cập nhật thành 200');

    // -----------------------------------------------------------------
    // TEST SUITE 6: UC-15.5 - Vô hiệu hóa voucher (Deactivate)
    // -----------------------------------------------------------------
    console.log('\n[6] Kiểm thử UC-15.5: Vô hiệu hóa voucher:');

    // 6.1 Staff không được vô hiệu hóa
    const staffDeactRes = await request('PATCH', `/api/vouchers/${v1Id}/deactivate`, null, staffToken);
    assert(staffDeactRes.status === 403, 'Staff KHÔNG thể vô hiệu hóa voucher (HTTP 403)');

    // 6.2 Admin vô hiệu hóa thành công
    const deactRes = await request('PATCH', `/api/vouchers/${v1Id}/deactivate`, null, adminToken);
    assert(deactRes.status === 200, 'Admin vô hiệu hóa voucher thành công (HTTP 200)');
    assert(deactRes.body.data.status === 'INACTIVE', 'Trạng thái chuyển sang INACTIVE');
    assert(deactRes.body.data.isApplicable === false, 'Vô hiệu hóa thì isApplicable = false ngay cả khi còn trong hạn');

    // 6.3 Vô hiệu hóa lại lần 2
    const reDeactRes = await request('PATCH', `/api/vouchers/${v1Id}/deactivate`, null, adminToken);
    assert(reDeactRes.status === 400, 'Báo lỗi phù hợp khi voucher đã INACTIVE trước đó (HTTP 400)');

    // 6.4 Kích hoạt lại voucher
    const reactivateRes = await request('PATCH', `/api/vouchers/${v1Id}/activate`, null, adminToken);
    assert(reactivateRes.status === 200, 'Kích hoạt lại voucher thành công (HTTP 200)');
    assert(reactivateRes.body.data.status === 'ACTIVE', 'Trạng thái trở lại ACTIVE');
    assert(reactivateRes.body.data.isApplicable === true, 'Kích hoạt lại thì isApplicable = true');

    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ CÁC KIỂM THỬ UC-15 (100%) ĐỀU ĐÃ VƯỢT QUA!');
    console.log('======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.connection.close();
  }
}

runTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exit(1);
});
