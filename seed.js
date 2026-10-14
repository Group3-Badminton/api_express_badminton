const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

// Import các Models
const User = require('./src/models/user');
const Court = require('./src/models/court');
const TimeSlot = require('./src/models/timeSlot');
const Price = require('./src/models/price');
const Booking = require('./src/models/booking');

dotenv.config();

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối cơ sở dữ liệu thành công!');

    // 1. Xóa dữ liệu cũ theo thứ tự phù hợp
    await Promise.all([
      User.deleteMany({}),
      Court.deleteMany({}),
      TimeSlot.deleteMany({}),
      Price.deleteMany({}),
      Booking.deleteMany({})
    ]);
    console.log('🗑️ Đã xóa sạch dữ liệu cũ.');

    // 2. Tạo Mật khẩu mẫu chung (123456)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);

    // 3. Tạo Users (CUSTOMER, ADMIN, STAFF)
    const users = await User.create([
      {
        fullName: 'Nguyễn Văn Khách',
        email: 'customer@gmail.com',
        password: hashedPassword,
        phone: '0901234567',
        address: '123 Đường 3/2, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER'
      },
      {
        fullName: 'Trần Thị Lan',
        email: 'lan.tran@gmail.com',
        password: hashedPassword,
        phone: '0912345678',
        address: '88 Nguyễn Trãi, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER'
      },
      {
        fullName: 'Lê Hoàng Long',
        email: 'long.le@gmail.com',
        password: hashedPassword,
        phone: '0933456789',
        address: '45 Mậu Thân, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER'
      },
      {
        fullName: 'Quản Trị Viên Sân',
        email: 'admin@gmail.com',
        password: hashedPassword,
        phone: '0909999999',
        address: '456 Lê Lợi, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'ADMIN'
      },
      {
        fullName: 'Nhân Viên Quản Sân',
        email: 'staff@gmail.com',
        password: hashedPassword,
        phone: '0908888888',
        address: '789 Trần Hưng Đạo, Cần Thơ',
        status: 'ACTIVE',
        role: 'STAFF'
      }
    ]);
    console.log('👤 Đã tạo thành công các tài khoản mẫu (User).');

    const customer1 = users.find(u => u.email === 'customer@gmail.com');
    const customer2 = users.find(u => u.email === 'lan.tran@gmail.com');
    const customer3 = users.find(u => u.email === 'long.le@gmail.com');

    // 4. Tạo Sân (COURTS)
    const courts = await Court.create([
      {
        courtName: 'Sân Cầu Lông Số 1',
        courtType: 'Sân Thảm Tiêu Chuẩn',
        location: 'Khu vực A (Trong nhà)',
        description: 'Sân trong nhà thoáng mát, ánh sáng chuẩn thi đấu.',
        status: 'ACTIVE'
      },
      {
        courtName: 'Sân Cầu Lông Số 2',
        courtType: 'Sân Gỗ Cao Cấp',
        location: 'Khu vực B (Trong nhà)',
        description: 'Sân sàn gỗ chuyên nghiệp, chống trơn trượt.',
        status: 'ACTIVE'
      },
      {
        courtName: 'Sân Cầu Lông Số 3',
        courtType: 'Sân Thảm PVC Chuyên Nghiệp',
        location: 'Khu vực A (Trong nhà)',
        description: 'Sân đạt chuẩn giải đấu quốc gia, có khán đài mini.',
        status: 'ACTIVE'
      },
      {
        courtName: 'Sân Cầu Lông Số 4',
        courtType: 'Sân Thảm Tiêu Chuẩn',
        location: 'Khu vực C (VIP)',
        description: 'Phòng sân riêng VIP điều hòa, phòng thay đồ riêng.',
        status: 'ACTIVE'
      }
    ]);
    console.log('🏸 Đã tạo thành công danh sách Sân (Courts).');

    // 5. Tạo Khung Giờ (TIME_SLOTS)
    const timeSlots = await TimeSlot.create([
      {
        startTime: '06:00',
        endTime: '08:00',
        label: 'Ca Sáng Sớm',
        status: 'ACTIVE'
      },
      {
        startTime: '08:00',
        endTime: '10:00',
        label: 'Ca Sáng 2',
        status: 'ACTIVE'
      },
      {
        startTime: '15:00',
        endTime: '17:00',
        label: 'Ca Chiều',
        status: 'ACTIVE'
      },
      {
        startTime: '17:00',
        endTime: '19:00',
        label: 'Ca Chiều Tối (Giờ Vàng)',
        status: 'ACTIVE'
      },
      {
        startTime: '19:00',
        endTime: '21:00',
        label: 'Ca Tối (Giờ Vàng)',
        status: 'ACTIVE'
      }
    ]);
    console.log('⏰ Đã tạo thành công các Khung Giờ (Time Slots).');

    // 6. Tạo Bảng Giá (PRICE)
    await Price.create([
      {
        courtId: courts[0]._id,
        timeSlotId: timeSlots[0]._id,
        dayType: 'WEEKDAY',
        timeSlot: '06:00 - 08:00',
        price: 80000,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-12-31'),
        status: 'ACTIVE'
      },
      {
        courtId: courts[0]._id,
        timeSlotId: timeSlots[3]._id,
        dayType: 'WEEKEND',
        timeSlot: '17:00 - 19:00',
        price: 120000,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: new Date('2026-12-31'),
        status: 'ACTIVE'
      }
    ]);
    console.log('💲 Đã tạo thành công Bảng Giá (Prices).');

    // 7. Tạo Lịch Đặt Sân (BOOKINGS) đa dạng
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await Booking.create([
      {
        customerId: customer1._id,
        courtId: courts[0]._id,
        voucherId: null,
        bookingCode: 'BK2026101401',
        bookingDate: today,
        startTime: '17:00',
        endTime: '19:00',
        price: 120000,
        discount: 0,
        totalAmount: 120000,
        status: 'PENDING',
        paymentStatus: 'PAID',
        paymentMethod: 'VIETQR',
        note: 'Khách đặt qua app, chờ xác nhận giữ sân'
      },
      {
        customerId: customer2._id,
        courtId: courts[1]._id,
        voucherId: null,
        bookingCode: 'BK2026101402',
        bookingDate: today,
        startTime: '19:00',
        endTime: '21:00',
        price: 140000,
        discount: 20000,
        totalAmount: 120000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'TRANSFER',
        note: 'Đã xác nhận đơn, đã chuyển khoản qua ngân hàng'
      },
      {
        customerId: customer3._id,
        courtId: courts[2]._id,
        voucherId: null,
        bookingCode: 'BK2026101403',
        bookingDate: today,
        startTime: '06:00',
        endTime: '08:00',
        price: 90000,
        discount: 0,
        totalAmount: 90000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        note: 'Đã duyệt đơn và giữ sân'
      },
      {
        customerId: customer1._id,
        courtId: courts[3]._id,
        voucherId: null,
        bookingCode: 'BK2026101404',
        bookingDate: tomorrow,
        startTime: '17:00',
        endTime: '19:00',
        price: 160000,
        discount: 0,
        totalAmount: 160000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'ONLINE',
        note: 'Đặt sân VIP giao lưu câu lạc bộ - Đã duyệt'
      },
      {
        customerId: customer2._id,
        courtId: courts[0]._id,
        voucherId: null,
        bookingCode: 'BK2026101405',
        bookingDate: tomorrow,
        startTime: '15:00',
        endTime: '17:00',
        price: 100000,
        discount: 0,
        totalAmount: 100000,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Đơn mới gửi, chờ quản trị duyệt đơn'
      },
      {
        customerId: customer3._id,
        courtId: courts[1]._id,
        voucherId: null,
        bookingCode: 'BK2026101406',
        bookingDate: yesterday,
        startTime: '17:00',
        endTime: '19:00',
        price: 120000,
        discount: 0,
        totalAmount: 120000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'VIETQR',
        note: 'Đã xác nhận lịch đặt'
      },
      {
        customerId: customer1._id,
        courtId: courts[2]._id,
        voucherId: null,
        bookingCode: 'BK2026101407',
        bookingDate: yesterday,
        startTime: '19:00',
        endTime: '21:00',
        price: 130000,
        discount: 0,
        totalAmount: 130000,
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        paymentMethod: 'TRANSFER',
        note: 'Khách bận việc đột xuất xin hủy trước 4 tiếng, đã hoàn tiền cọc'
      }
    ]);
    console.log('📅 Đã tạo thành công 7 Lịch Đặt Sân mẫu (Bookings).');

    console.log('\n🎉 HOÀN TẤT NẠP DỮ LIỆU SEED CHO TOÀN BỘ HỆ THỐNG!');
    console.log('--------------------------------------------------');
    console.log(' 1. Khách hàng: customer@gmail.com / 123456');
    console.log(' 2. Quản trị:   admin@gmail.com / 123456');
    console.log(' 3. Nhân viên:  staff@gmail.com / 123456');
    console.log('--------------------------------------------------');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi nạp dữ liệu:', error);
    process.exit(1);
  }
}

seedData();