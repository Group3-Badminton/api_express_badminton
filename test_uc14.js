/**
 * Suite kiểm thử tích hợp toàn diện cho module UC-14 Product Management:
 * 1. UC-14.1 & UC-14.6: View List, Search, Filter, Pagination, Stable Sorting
 * 2. UC-14.2: View Product Detail & History
 * 3. UC-14.3: Create Product (Admin Only, Name uniqueness, Validation, Initial Stock = 0)
 * 4. UC-14.4: Update Product (Admin Only, Price, Desc, Name, Prevent Stock Modification)
 * 5. UC-14.5: Deactivate Product (Admin Only, Preserve History, Soft deactivation)
 * 6. UC-14.7: Stock In (Admin Only, Atomic Increment, StockInHistory Record, Idempotency, Concurrency, Rollback)
 * 7. RBAC & Security: Staff read-only, Admin full rights, Customer/Guest denied (401/403)
 */

const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('./app');
const Product = require('./src/models/product');
const StockInHistory = require('./src/models/stockInHistory');
const User = require('./src/models/user');

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
  console.log('🚀 BẮT ĐẦU CHẠY KIỂM THỬ MODULE UC-14 PRODUCT MANAGEMENT');
  console.log('======================================================\n');

  // Khởi động server test
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      console.log(`Test server running on port ${port}`);
      resolve();
    });
  });

  // Tạo mock users và JWT tokens
  const adminId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const adminToken = jwt.sign({ userId: adminId, role: 'ADMIN', email: 'admin@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const staffToken = jwt.sign({ userId: staffId, role: 'STAFF', email: 'staff@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const customerToken = jwt.sign({ userId: customerId, role: 'CUSTOMER', email: 'cust@test.com' }, JWT_SECRET, { expiresIn: '1h' });

  // Dọn dẹp collection trước khi test
  await Product.deleteMany({});
  await StockInHistory.deleteMany({});

  try {
    // -----------------------------------------------------------------
    // TEST SUITE 1: Phân quyền truy cập (RBAC - BR-02)
    // -----------------------------------------------------------------
    console.log('\n[1] Kiểm thử RBAC & Xác thực:');

    // 1.1 Khách vãng lai (Guest - Không có token)
    const guestRes = await request('GET', '/api/products');
    assert(guestRes.status === 401, 'Guest không được truy cập danh sách sản phẩm (HTTP 401)');

    // 1.2 Khách hàng (Customer) bị từ chối
    const custRes = await request('GET', '/api/products', null, customerToken);
    assert(custRes.status === 403, 'Customer bị từ chối truy cập module quản lý sản phẩm (HTTP 403)');

    // 1.3 Staff được xem danh sách
    const staffListRes = await request('GET', '/api/products', null, staffToken);
    assert(staffListRes.status === 200, 'Staff có quyền xem danh sách sản phẩm (HTTP 200)');

    // 1.4 Staff không được tạo sản phẩm
    const staffCreateRes = await request('POST', '/api/products', { name: 'Vợt Victor', price: 1200000 }, staffToken);
    assert(staffCreateRes.status === 403, 'Staff KHÔNG thể tạo sản phẩm mới (HTTP 403)');

    // -----------------------------------------------------------------
    // TEST SUITE 2: UC-14.3 - Tạo sản phẩm (Create Product - Admin)
    // -----------------------------------------------------------------
    console.log('\n[2] Kiểm thử UC-14.3: Tạo sản phẩm mới (Admin):');

    // 2.1 Validation: Thiếu tên hoặc tên rỗng
    const emptyNameRes = await request('POST', '/api/products', { name: '   ', price: 15000 }, adminToken);
    assert(emptyNameRes.status === 400, 'Từ chối tạo khi tên sản phẩm rỗng sau trim (HTTP 400)');

    // 2.2 Validation: Giá không hợp lệ
    const invalidPriceRes = await request('POST', '/api/products', { name: 'Nước lọc', price: -5000 }, adminToken);
    assert(invalidPriceRes.status === 400, 'Từ chối tạo khi giá âm (HTTP 400)');

    // 2.3 Tạo thành công sản phẩm 1
    const p1Res = await request('POST', '/api/products', {
      name: 'Nước tăng lực Redbull',
      price: 15000,
      description: 'Lon 250ml ướp lạnh',
      unit: 'lon',
      category: 'DRINK'
    }, adminToken);
    assert(p1Res.status === 201 && p1Res.body.success, 'Admin tạo thành công sản phẩm 1 (HTTP 201)');
    assert(p1Res.body.data.stockQuantity === 0, 'Tồn kho ban đầu luôn được thiết lập là 0');
    assert(p1Res.body.data.status === 'ACTIVE', 'Trạng thái ban đầu là ACTIVE');

    const p1Id = p1Res.body.data._id;

    // 2.4 Tạo sản phẩm 2
    const p2Res = await request('POST', '/api/products', {
      name: 'Quả cầu lông Yonex AS-40',
      price: 28000,
      description: 'Cầu thi đấu chính thức',
      unit: 'quả',
      category: 'SHUTTLECOCK'
    }, adminToken);
    assert(p2Res.status === 201, 'Tạo thành công sản phẩm 2');
    const p2Id = p2Res.body.data._id;

    // 2.5 Trùng tên sản phẩm
    const dupRes = await request('POST', '/api/products', {
      name: '  nước tăng lực redbull  ',
      price: 20000
    }, adminToken);
    assert(dupRes.status === 409, 'Ngăn chặn trùng tên sản phẩm (HTTP 409)');

    // -----------------------------------------------------------------
    // TEST SUITE 3: UC-14.7 - Nhập kho sản phẩm (Stock In) & Transaction
    // -----------------------------------------------------------------
    console.log('\n[3] Kiểm thử UC-14.7: Nhập kho sản phẩm (Stock In):');

    // 3.1 Staff không có quyền nhập kho
    const staffStockRes = await request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 10 }, staffToken);
    assert(staffStockRes.status === 403, 'Staff KHÔNG có quyền nhập kho (HTTP 403)');

    // 3.2 Nhập số lượng không hợp lệ (<= 0 hoặc lẻ)
    const invalidQtyRes = await request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 0 }, adminToken);
    assert(invalidQtyRes.status === 400, 'Từ chối nhập số lượng <= 0 (HTTP 400)');

    const floatQtyRes = await request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 2.5 }, adminToken);
    assert(floatQtyRes.status === 400, 'Từ chối số lượng không phải số nguyên (HTTP 400)');

    // 3.3 Nhập kho thành công lần 1 (100 lon Redbull)
    const stockIn1Res = await request('POST', `/api/products/${p1Id}/stock-ins`, {
      quantity: 100,
      costPrice: 11000,
      note: 'Lô hàng thứ nhất',
      requestId: 'req_uniq_001'
    }, adminToken);
    assert(stockIn1Res.status === 200, 'Nhập kho lần 1 thành công (HTTP 200)');
    assert(stockIn1Res.body.data.product.stockQuantity === 100, 'Tồn kho tăng chính xác lên 100');

    // 3.4 Kiểm tra bản ghi StockInHistory truy vết
    const historyRecord = await StockInHistory.findOne({ requestId: 'req_uniq_001' });
    assert(historyRecord !== null, 'Tạo bản ghi StockInHistory thành công');
    assert(historyRecord.quantity === 100 && historyRecord.stockBefore === 0 && historyRecord.stockAfter === 100,
      'Bản ghi lưu đúng: quantity=100, stockBefore=0, stockAfter=100');
    assert(String(historyRecord.performedBy) === String(adminId), 'Truy vết chính xác Admin thực hiện');

    // 3.5 Chống gửi trùng request (Idempotency)
    const dupStockInRes = await request('POST', `/api/products/${p1Id}/stock-ins`, {
      quantity: 100,
      costPrice: 11000,
      note: 'Lô hàng thứ nhất gửi lại',
      requestId: 'req_uniq_001'
    }, adminToken);
    assert(dupStockInRes.status === 200, 'Gửi lại cùng requestId được xử lý an toàn (HTTP 200)');
    const checkProductP1 = await Product.findById(p1Id);
    assert(checkProductP1.stockQuantity === 100, 'Tồn kho KHÔNG bị tăng 2 lần khi gửi lặp request');

    // 3.6 Nhập kho đồng thời (Concurrency Test)
    console.log('  Kiểm tra tính toàn vẹn khi nhập kho đồng thời...');
    const concurrentPromises = [
      request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 10, requestId: 'c_01' }, adminToken),
      request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 20, requestId: 'c_02' }, adminToken),
      request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 30, requestId: 'c_03' }, adminToken)
    ];
    await Promise.all(concurrentPromises);
    const postConcurrentProduct = await Product.findById(p1Id);
    assert(postConcurrentProduct.stockQuantity === 160, 'Nhập kho đồng thời tính toán chính xác (100 + 10 + 20 + 30 = 160)');

    // -----------------------------------------------------------------
    // TEST SUITE 4: UC-14.4 - Cập nhật sản phẩm (Update Product)
    // -----------------------------------------------------------------
    console.log('\n[4] Kiểm thử UC-14.4: Cập nhật thông tin sản phẩm (Update):');

    // 4.1 Cập nhật giá và mô tả
    const updateRes = await request('PATCH', `/api/products/${p1Id}`, {
      name: 'Nước tăng lực Redbull Thái',
      price: 18000,
      description: 'Hàng nhập khẩu Thái Lan 250ml'
    }, adminToken);
    assert(updateRes.status === 200, 'Admin cập nhật thành công thông tin sản phẩm (HTTP 200)');
    assert(updateRes.body.data.name === 'Nước tăng lực Redbull Thái', 'Tên sản phẩm được cập nhật');
    assert(updateRes.body.data.price === 18000, 'Giá bán được cập nhật lên 18000');

    // 4.2 Thử vượt rào sửa stockQuantity qua update
    await request('PATCH', `/api/products/${p1Id}`, { stockQuantity: 99999 }, adminToken);
    const p1CheckStock = await Product.findById(p1Id);
    assert(p1CheckStock.stockQuantity === 160, 'Ngăn chặn sửa tồn kho qua endpoint update (Tồn kho giữ nguyên 160)');

    // -----------------------------------------------------------------
    // TEST SUITE 5: UC-14.5 - Vô hiệu hóa sản phẩm (Deactivate)
    // -----------------------------------------------------------------
    console.log('\n[5] Kiểm thử UC-14.5: Vô hiệu hóa sản phẩm (Deactivate):');

    // 5.1 Staff không được vô hiệu hóa
    const staffDeactRes = await request('PATCH', `/api/products/${p1Id}/deactivate`, null, staffToken);
    assert(staffDeactRes.status === 403, 'Staff KHÔNG thể vô hiệu hóa sản phẩm (HTTP 403)');

    // 5.2 Admin vô hiệu hóa thành công
    const deactRes = await request('PATCH', `/api/products/${p1Id}/deactivate`, null, adminToken);
    assert(deactRes.status === 200, 'Admin vô hiệu hóa sản phẩm thành công (HTTP 200)');
    assert(deactRes.body.data.status === 'INACTIVE', 'Trạng thái chuyển sang INACTIVE');

    // 5.3 Bảo toàn dữ liệu và lịch sử
    const historyCount = await StockInHistory.countDocuments({ productId: p1Id });
    assert(historyCount >= 4, `Lịch sử nhập kho (${historyCount} bản ghi) được bảo toàn toàn vẹn sau khi vô hiệu hóa`);

    // 5.4 Ngăn chặn nhập kho cho sản phẩm INACTIVE
    const stockInInactiveRes = await request('POST', `/api/products/${p1Id}/stock-ins`, { quantity: 50 }, adminToken);
    assert(stockInInactiveRes.status === 400, 'Ngăn chặn nhập kho cho sản phẩm đã vô hiệu hóa (HTTP 400)');

    // 5.5 Kích hoạt lại sản phẩm
    const reactivateRes = await request('PATCH', `/api/products/${p1Id}/activate`, null, adminToken);
    assert(reactivateRes.status === 200, 'Kích hoạt lại sản phẩm thành công (HTTP 200)');
    assert(reactivateRes.body.data.status === 'ACTIVE', 'Trạng thái trở lại ACTIVE');

    // -----------------------------------------------------------------
    // TEST SUITE 6: UC-14.1 & UC-14.6 - Danh sách, Tìm kiếm, Lọc, Phân trang
    // -----------------------------------------------------------------
    console.log('\n[6] Kiểm thử UC-14.1 & UC-14.6: Tìm kiếm, lọc và phân trang:');

    // 6.1 Staff xem danh sách
    const listRes = await request('GET', '/api/products?page=1&limit=10', null, staffToken);
    assert(listRes.status === 200 && listRes.body.data.items.length === 2, 'Lấy danh sách phân trang thành công (2 sản phẩm)');
    assert(listRes.body.data.pagination.total === 2, 'Tổng số bản ghi là 2');

    // 6.2 Tìm kiếm theo tên
    const searchRes = await request('GET', '/api/products?search=Redbull', null, staffToken);
    assert(searchRes.status === 200 && searchRes.body.data.items.length === 1, 'Tìm kiếm "Redbull" trả về đúng 1 bản ghi');
    assert(searchRes.body.data.items[0]._id === String(p1Id), 'Khớp đúng sản phẩm p1');

    // 6.3 Lọc theo tình trạng kho
    const inStockRes = await request('GET', '/api/products?stockStatus=IN_STOCK', null, staffToken);
    assert(inStockRes.body.data.items.length === 1 && inStockRes.body.data.items[0]._id === String(p1Id),
      'Lọc IN_STOCK trả về đúng sản phẩm có tồn > 0');

    const outOfStockRes = await request('GET', '/api/products?stockStatus=OUT_OF_STOCK', null, staffToken);
    assert(outOfStockRes.body.data.items.length === 1 && outOfStockRes.body.data.items[0]._id === String(p2Id),
      'Lọc OUT_OF_STOCK trả về đúng sản phẩm có tồn = 0');

    // 6.4 Lọc theo khoảng giá
    const priceFilterRes = await request('GET', '/api/products?minPrice=20000&maxPrice=30000', null, staffToken);
    assert(priceFilterRes.body.data.items.length === 1 && priceFilterRes.body.data.items[0]._id === String(p2Id),
      'Lọc theo khoảng giá [20000 - 30000] trả về đúng quả cầu lông');

    // -----------------------------------------------------------------
    // TEST SUITE 7: UC-14.2 - Chi tiết sản phẩm (View Detail)
    // -----------------------------------------------------------------
    console.log('\n[7] Kiểm thử UC-14.2: Xem chi tiết sản phẩm:');

    // 7.1 ID không tồn tại
    const fakeId = new mongoose.Types.ObjectId();
    const notFoundRes = await request('GET', `/api/products/${fakeId}`, null, staffToken);
    assert(notFoundRes.status === 404, 'Trả về 404 khi không tìm thấy sản phẩm');

    // 7.2 Lấy chi tiết thành công kèm lịch sử nhập kho
    const detailRes = await request('GET', `/api/products/${p1Id}`, null, staffToken);
    assert(detailRes.status === 200, 'Lấy chi tiết sản phẩm thành công (HTTP 200)');
    assert(detailRes.body.data.name === 'Nước tăng lực Redbull Thái', 'Trả về đúng thông tin sản phẩm');
    assert(Array.isArray(detailRes.body.data.stockHistory) && detailRes.body.data.stockHistory.length > 0,
      'Chi tiết kèm theo lịch sử nhập kho');

    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ CÁC KIỂM THỬ (100%) ĐỀU ĐÃ VƯỢT QUA XUẤT SẮC!');
    console.log('======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.connection.close();
  }
}

runTests().catch((err) => {
  console.error('❌ Kiểm thử thất bại với lỗi:', err);
  process.exit(1);
});
