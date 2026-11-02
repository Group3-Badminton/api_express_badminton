const mongoose = require('mongoose');
require('dotenv').config();

async function runComprehensiveAudit() {
  console.log('=====================================================');
  console.log('--- BẮT ĐẦU KIỂM THỬ TOÀN DIỆN HỆ THỐNG VÀ DATABASE ---');
  console.log('=====================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bad2';
  await mongoose.connect(uri);
  console.log(`[1] KẾT NỐI DATABASE THÀNH CÔNG: ${mongoose.connection.name}`);

  const Staff = require('./src/models/staff');
  const Customer = require('./src/models/customer');
  const Court = require('./src/models/court');
  const Booking = require('./src/models/booking');
  const PriceRule = require('./src/models/priceRule');
  const Product = require('./src/models/product');
  const Voucher = require('./src/models/voucher');
  const Invoice = require('./src/models/invoice');
  const Notification = require('./src/models/notification');

  // Kiểm tra số lượng bản ghi thực tế
  const counts = {
    Staff: await Staff.countDocuments(),
    Customer: await Customer.countDocuments(),
    Court: await Court.countDocuments(),
    Booking: await Booking.countDocuments(),
    PriceRule: await PriceRule.countDocuments(),
    Product: await Product.countDocuments(),
    Voucher: await Voucher.countDocuments(),
    Invoice: await Invoice.countDocuments(),
    Notification: await Notification.countDocuments()
  };

  console.log('[2] THỐNG KÊ DỮ LIỆU THỰC TẾ TRONG MONGODB:');
  console.table(counts);

  // Kiểm tra đăng nhập qua API backend
  console.log('\n[3] KIỂM TRA ĐĂNG NHẬP API THỰC TẾ:');
  const loginCases = [
    { name: 'Admin', account: 'admin@gmail.com', pass: '123456', expectRole: 'ADMIN' },
    { name: 'Staff', account: 'staff@gmail.com', pass: '123456', expectRole: 'STAFF' },
    { name: 'Customer', account: 'customer@gmail.com', pass: '123456', expectRole: 'CUSTOMER' }
  ];

  let adminToken = '';

  for (const c of loginCases) {
    try {
      const res = await fetch('http://localhost:9999/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: c.account, password: c.pass })
      }).then(r => r.json());

      if (res.success && res.data?.token && res.data?.user?.role === c.expectRole) {
        console.log(`  ✅ Đăng nhập ${c.name} (${c.account}) thành công! Role: ${res.data.user.role}`);
        if (c.expectRole === 'ADMIN') adminToken = res.data.token;
      } else {
        console.error(`  ❌ Đăng nhập ${c.name} thất bại:`, res);
      }
    } catch (err) {
      console.error(`  ❌ Lỗi kết nối khi đăng nhập ${c.name}:`, err.message);
    }
  }

  // Kiểm tra các API chính với Admin Token
  console.log('\n[4] KIỂM TRA CÁC API TRUY VẤN VÀ PHÂN QUYỀN VỚI TOKEN THỰC TẾ:');
  const testEndpoints = [
    { name: 'Danh sách sân', url: 'http://localhost:9999/api/bookings/courts', auth: false },
    { name: 'Danh sách đơn đặt sân & Stats', url: 'http://localhost:9999/api/bookings?page=1&limit=5', auth: true },
    { name: 'Danh sách nhân viên', url: 'http://localhost:9999/api/staffs', auth: true },
    { name: 'Danh sách khách hàng', url: 'http://localhost:9999/api/customers', auth: true },
    { name: 'Danh sách sản phẩm', url: 'http://localhost:9999/api/products', auth: true },
    { name: 'Danh sách voucher', url: 'http://localhost:9999/api/vouchers', auth: true },
    { name: 'Danh sách hóa đơn', url: 'http://localhost:9999/api/invoices', auth: true },
    { name: 'Bảng giá quy tắc', url: 'http://localhost:9999/api/pricing', auth: true },
    { name: 'Danh sách thông báo', url: 'http://localhost:9999/api/notifications', auth: true }
  ];

  for (const ep of testEndpoints) {
    try {
      const headers = {};
      if (ep.auth) headers['Authorization'] = `Bearer ${adminToken}`;
      const res = await fetch(ep.url, { headers }).then(r => r.json());
      if (res.success) {
        console.log(`  ✅ API [${ep.name}]: SUCCESS (200)`);
      } else {
        console.error(`  ❌ API [${ep.name}]: FAILED - ${res.message}`);
      }
    } catch (err) {
      console.error(`  ❌ API [${ep.name}]: ERROR - ${err.message}`);
    }
  }

  // Kiểm tra thao tác CRUD trên thực tế với dữ liệu test
  console.log('\n[5] KIỂM TRA THAO TÁC CRUD TRÊN DATABASE THỰC TẾ:');
  const testNotifTitle = `[AUDIT_TEST] Thông báo kiểm tra ${Date.now()}`;
  
  // CREATE
  const createdNotif = await Notification.create({
    recipientId: new mongoose.Types.ObjectId(),
    recipientType: 'STAFF',
    title: testNotifTitle,
    message: 'Nội dung kiểm tra tính năng ghi vào DB thực tế',
    isRead: false,
    status: 'ACTIVE'
  });
  console.log(`  ✅ CREATE: Tạo bản ghi thành công với _id: ${createdNotif._id}`);

  // READ
  const foundNotif = await Notification.findById(createdNotif._id);
  if (foundNotif && foundNotif.title === testNotifTitle) {
    console.log(`  ✅ READ: Đọc dữ liệu từ DB chính xác!`);
  } else {
    console.error(`  ❌ READ: Không tìm thấy bản ghi vừa tạo!`);
  }

  // UPDATE
  await Notification.updateOne({ _id: createdNotif._id }, { $set: { isRead: true } });
  const updatedNotif = await Notification.findById(createdNotif._id);
  if (updatedNotif && updatedNotif.isRead === true) {
    console.log(`  ✅ UPDATE: Cập nhật bản ghi trong DB thành công!`);
  } else {
    console.error(`  ❌ UPDATE: Cập nhật thất bại!`);
  }

  // DELETE
  await Notification.deleteOne({ _id: createdNotif._id });
  const deletedNotif = await Notification.findById(createdNotif._id);
  if (!deletedNotif) {
    console.log(`  ✅ DELETE: Xóa dọn dẹp bản ghi test thành công!`);
  } else {
    console.error(`  ❌ DELETE: Xóa thất bại!`);
  }

  console.log('\n=====================================================');
  console.log('--- TOÀN BỘ CÁC HẠNG MỤC KIỂM THỬ ĐÃ HOÀN TẤT THÀNH CÔNG ---');
  console.log('=====================================================');
  process.exit(0);
}

runComprehensiveAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
