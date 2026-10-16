const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

// Import tất cả Models theo thiết kế hệ thống
const User = require('./src/models/user');
const Customer = require('./src/models/customer');
const Staff = require('./src/models/staff');
const Court = require('./src/models/court');
const TimeSlot = require('./src/models/timeSlot');
const Price = require('./src/models/price');
const Booking = require('./src/models/booking');
const Product = require('./src/models/product');
const Notification = require('./src/models/notification');
const PlayingSession = require('./src/models/playingSession');
const Voucher = require('./src/models/voucher');
const Invoice = require('./src/models/invoice');

dotenv.config();

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối cơ sở dữ liệu MongoDB thành công!');

    // 1. Xóa dữ liệu cũ của toàn bộ 11 collections
    await Promise.all([
      User.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
      Court.deleteMany({}),
      TimeSlot.deleteMany({}),
      Price.deleteMany({}),
      Booking.deleteMany({}),
      Product.deleteMany({}),
      Notification.deleteMany({}),
      PlayingSession.deleteMany({}),
      Voucher.deleteMany({}),
      Invoice.deleteMany({})
    ]);
    console.log('🗑️ Đã xóa sạch dữ liệu cũ trong 11 collections.');

    // 2. Mật khẩu mẫu chung đã mã hóa: '123456'
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);

    // 3. Tạo USERS (CUSTOMER, ADMIN, STAFF)
    const users = await User.create([
      {
        fullName: 'Nguyễn Văn Khách',
        email: 'customer@gmail.com',
        password: hashedPassword,
        phone: '0901234567',
        address: '123 Đường 3/2, Q. Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER'
      },
      {
        fullName: 'Trần Thị Lan',
        email: 'lan.tran@gmail.com',
        password: hashedPassword,
        phone: '0912345678',
        address: '88 Nguyễn Trãi, Q. Ninh Kiều, Cần Thơ',
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
        address: '456 Lê Lợi, Cần Thơ',
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
    console.log('👤 Đã tạo thành công danh sách Users.');

    // 4. Tạo CUSTOMERS & STAFF (theo đúng entity diagram)
    await Customer.create([
      {
        _id: users[0]._id,
        fullName: users[0].fullName,
        email: users[0].email,
        password: hashedPassword,
        phone: users[0].phone,
        address: users[0].address,
        status: 'ACTIVE'
      },
      {
        _id: users[1]._id,
        fullName: users[1].fullName,
        email: users[1].email,
        password: hashedPassword,
        phone: users[1].phone,
        address: users[1].address,
        status: 'ACTIVE'
      },
      {
        _id: users[2]._id,
        fullName: users[2].fullName,
        email: users[2].email,
        password: hashedPassword,
        phone: users[2].phone,
        address: users[2].address,
        status: 'ACTIVE'
      }
    ]);

    await Staff.create([
      {
        _id: users[3]._id,
        fullName: users[3].fullName,
        email: users[3].email,
        password: hashedPassword,
        phone: users[3].phone,
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      {
        _id: users[4]._id,
        fullName: users[4].fullName,
        email: users[4].email,
        password: hashedPassword,
        phone: users[4].phone,
        role: 'STAFF',
        status: 'ACTIVE'
      }
    ]);
    console.log('👥 Đã tạo thành công CUSTOMERS và STAFF riêng biệt.');

    const customer1 = users[0];
    const customer2 = users[1];
    const customer3 = users[2];
    const staff1 = users[4];

    // 5. Tạo SÂN (COURTS)
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
        description: 'Sân sàn gỗ chuyên nghiệp, giảm chấn và chống trơn trượt.',
        status: 'ACTIVE'
      },
      {
        courtName: 'Sân Cầu Lông Số 3',
        courtType: 'Sân Thảm PVC Chuyên Nghiệp',
        location: 'Khu vực A (Trong nhà)',
        description: 'Sân đạt chuẩn giải đấu quốc gia, trang bị khán đài mini.',
        status: 'ACTIVE'
      },
      {
        courtName: 'Sân Cầu Lông Số 4 (VIP)',
        courtType: 'Sân VIP Điều Hòa',
        location: 'Khu vực C (VIP)',
        description: 'Phòng sân riêng VIP điều hòa, phòng thay đồ và nước uống riêng.',
        status: 'ACTIVE'
      }
    ]);
    console.log('🏸 Đã tạo thành công danh sách COURTS.');

    // 6. Tạo KHUNG GIỜ (TIME_SLOTS)
    const timeSlots = await TimeSlot.create([
      {
        startTime: '06:00',
        endTime: '08:00',
        label: '06:00 - 08:00 (Sáng Sớm)',
        status: 'ACTIVE'
      },
      {
        startTime: '08:00',
        endTime: '10:00',
        label: '08:00 - 10:00 (Sáng)',
        status: 'ACTIVE'
      },
      {
        startTime: '10:00',
        endTime: '12:00',
        label: '10:00 - 12:00 (Trưa)',
        status: 'ACTIVE'
      },
      {
        startTime: '13:00',
        endTime: '15:00',
        label: '13:00 - 15:00 (Đầu Chiều)',
        status: 'ACTIVE'
      },
      {
        startTime: '15:00',
        endTime: '17:00',
        label: '15:00 - 17:00 (Chiều)',
        status: 'ACTIVE'
      },
      {
        startTime: '17:00',
        endTime: '19:00',
        label: '17:00 - 19:00 (Giờ Vàng Chiều Tối)',
        status: 'ACTIVE'
      },
      {
        startTime: '19:00',
        endTime: '21:00',
        label: '19:00 - 21:00 (Giờ Vàng Tối)',
        status: 'ACTIVE'
      },
      {
        startTime: '21:00',
        endTime: '23:00',
        label: '21:00 - 23:00 (Đêm)',
        status: 'ACTIVE'
      }
    ]);
    console.log('⏰ Đã tạo thành công danh sách TIME_SLOTS.');

    // 7. Tạo BẢNG GIÁ (PRICE)
    const prices = [];
    for (const court of courts) {
      const isVip = court.courtType.includes('VIP');
      for (const slot of timeSlots) {
        const isPeak = ['17:00', '19:00'].includes(slot.startTime);
        // Ngày trong tuần
        let basePrice = 80000;
        if (isPeak) basePrice = 120000;
        if (isVip) basePrice += 40000;

        prices.push({
          courtId: court._id,
          timeSlotId: slot._id,
          dayType: 'WEEKDAY',
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          price: basePrice,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'),
          status: 'ACTIVE'
        });

        // Cuối tuần
        prices.push({
          courtId: court._id,
          timeSlotId: slot._id,
          dayType: 'WEEKEND',
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          price: basePrice + 30000,
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: new Date('2026-12-31'),
          status: 'ACTIVE'
        });
      }
    }
    await Price.create(prices);
    console.log(`💲 Đã tạo thành công ${prices.length} bảng giá (PRICES) cho từng sân và khung giờ.`);

    // 8. Tạo KHUYẾN MÃI (VOUCHERS)
    const vouchers = await Voucher.create([
      {
        voucherCode: 'CHAOMUNG20',
        voucherName: 'Giảm 20% Chào Mừng Thành Viên Mới',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        maxDiscount: 50000,
        minOrderAmount: 80000,
        usageLimit: 500,
        usedCount: 15,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE'
      },
      {
        voucherCode: 'GIAM30K',
        voucherName: 'Giảm Ngay 30.000đ Cho Đơn Đặt Sân',
        discountType: 'FIXED',
        discountValue: 30000,
        maxDiscount: 30000,
        minOrderAmount: 100000,
        usageLimit: 200,
        usedCount: 22,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE'
      },
      {
        voucherCode: 'VIPBADMINTON',
        voucherName: 'Ưu Đãi Đặc Biệt Khách Hàng Thân Thiết Giảm 50k',
        discountType: 'FIXED',
        discountValue: 50000,
        maxDiscount: 50000,
        minOrderAmount: 150000,
        usageLimit: 100,
        usedCount: 5,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE'
      }
    ]);
    console.log('🎟️ Đã tạo thành công danh sách VOUCHERS.');

    // 9. Tạo SẢN PHẨM PHỤ TRỢ (PRODUCTS)
    await Product.create([
      {
        productName: 'Ống Cầu Lông Hải Yến (12 quả)',
        category: 'Cầu Lông',
        unit: 'Ống',
        sellingPrice: 220000,
        stockQuantity: 45,
        description: 'Cầu Hải Yến tiêu chuẩn thi đấu độ bền cao, quỹ đạo bay ổn định.',
        status: 'ACTIVE'
      },
      {
        productName: 'Nước Khoáng Lavie 500ml',
        category: 'Nước Uống',
        unit: 'Chai',
        sellingPrice: 10000,
        stockQuantity: 120,
        description: 'Nước khoáng thiên nhiên mát lạnh bổ sung khoáng chất.',
        status: 'ACTIVE'
      },
      {
        productName: 'Nước Tăng Lực Revive Chanh Muối 500ml',
        category: 'Nước Uống',
        unit: 'Chai',
        sellingPrice: 15000,
        stockQuantity: 80,
        description: 'Nước uống điện giải bù nước và phục hồi thể lực tức thì.',
        status: 'ACTIVE'
      },
      {
        productName: 'Băng Quấn Cán Vợt Yonex AC102EX',
        category: 'Phụ Kiện',
        unit: 'Cuộn',
        sellingPrice: 35000,
        stockQuantity: 60,
        description: 'Quấn cán vợt cao cấp siêu bám tay và thấm hút mồ hôi.',
        status: 'ACTIVE'
      }
    ]);
    console.log('🛒 Đã tạo thành công danh mục SẢN PHẨM (PRODUCTS).');

    // 10. Tạo ĐƠN ĐẶT SÂN (BOOKINGS)
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const bookings = await Booking.create([
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
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Khách đặt online, chờ duyệt sân'
      },
      {
        customerId: customer2._id,
        courtId: courts[1]._id,
        voucherId: vouchers[1]._id,
        bookingCode: 'BK2026101402',
        bookingDate: today,
        startTime: '19:00',
        endTime: '21:00',
        price: 150000,
        discount: 30000,
        totalAmount: 120000,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Đã xác nhận đơn đặt, áp dụng voucher GIAM30K'
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
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Thanh toán tiền mặt tại quầy khi nhận sân'
      },
      {
        customerId: customer1._id,
        courtId: courts[3]._id,
        voucherId: vouchers[2]._id,
        bookingCode: 'BK2026101404',
        bookingDate: tomorrow,
        startTime: '17:00',
        endTime: '19:00',
        price: 180000,
        discount: 50000,
        totalAmount: 130000,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Đặt sân VIP giao lưu câu lạc bộ'
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
        note: 'Đơn mới, khách thanh toán tại quầy khi nhận sân'
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
        status: 'COMPLETED',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Buổi chơi hoàn tất đúng giờ'
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
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        note: 'Khách báo bận việc đột xuất trước 6 tiếng'
      }
    ]);
    console.log('📅 Đã tạo thành công danh sách ĐƠN ĐẶT SÂN (BOOKINGS).');

    // 11. Tạo PHIÊN CHƠI SÂN (PLAYING_SESSIONS)
    const session1 = await PlayingSession.create({
      bookingId: bookings[2]._id, // BK2026101403
      staffId: staff1._id,
      checkInAt: new Date(today.setHours(6, 2, 0)),
      checkOutAt: new Date(today.setHours(8, 0, 0)),
      startTime: new Date(today.setHours(6, 0, 0)),
      endTime: new Date(today.setHours(8, 0, 0)),
      actualDuration: 120,
      totalAmount: 90000,
      status: 'COMPLETED',
      note: 'Khách nhận sân đúng giờ, sử dụng dịch vụ tốt'
    });

    const session2 = await PlayingSession.create({
      bookingId: bookings[5]._id, // BK2026101406
      staffId: staff1._id,
      checkInAt: new Date(yesterday.setHours(17, 0, 0)),
      checkOutAt: new Date(yesterday.setHours(19, 5, 0)),
      startTime: new Date(yesterday.setHours(17, 0, 0)),
      endTime: new Date(yesterday.setHours(19, 0, 0)),
      actualDuration: 125,
      totalAmount: 120000,
      status: 'COMPLETED',
      note: 'Hoàn thành phiên chơi'
    });
    console.log('🏸 Đã tạo thành công các PHIÊN CHƠI SÂN (PLAYING_SESSIONS).');

    // 12. Tạo HÓA ĐƠN (INVOICES)
    await Invoice.create([
      {
        playingSessionId: session1._id,
        staffId: staff1._id,
        invoiceCode: 'INV2026101401',
        subtotal: 90000,
        discountAmount: 0,
        totalAmount: 90000,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        issuedAt: new Date(),
        paidAt: new Date(),
        status: 'ACTIVE'
      },
      {
        playingSessionId: session2._id,
        staffId: staff1._id,
        invoiceCode: 'INV2026101402',
        subtotal: 120000,
        discountAmount: 0,
        totalAmount: 120000,
        paymentMethod: 'VIETQR',
        paymentStatus: 'PAID',
        issuedAt: yesterday,
        paidAt: yesterday,
        status: 'ACTIVE'
      }
    ]);
    console.log('🧾 Đã tạo thành công danh sách HÓA ĐƠN (INVOICES).');

    // 13. Tạo THÔNG BÁO (NOTIFICATIONS)
    await Notification.create([
      {
        recipientId: customer1._id,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_SUCCESS',
        title: 'Đặt sân thành công!',
        message: 'Đơn đặt sân #BK2026101401 của bạn đã được ghi nhận và đang chờ xác nhận.',
        isRead: false,
        status: 'ACTIVE'
      },
      {
        recipientId: customer2._id,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_CONFIRMED',
        title: 'Lịch đặt sân đã được duyệt!',
        message: 'Đơn đặt sân #BK2026101402 tại Sân Số 2 đã được nhân viên duyệt thành công.',
        isRead: true,
        status: 'ACTIVE'
      },
      {
        recipientId: staff1._id,
        recipientType: 'STAFF',
        type: 'NEW_BOOKING_ALERT',
        title: 'Có đơn đặt sân mới cần duyệt',
        message: 'Khách hàng Nguyễn Văn Khách vừa gửi đơn đặt sân mới #BK2026101401.',
        isRead: false,
        status: 'ACTIVE'
      }
    ]);
    console.log('🔔 Đã tạo thành công danh sách THÔNG BÁO (NOTIFICATIONS).');

    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ 11 COLLECTIONS ĐÃ ĐƯỢC NẠP DỮ LIỆU ĐỒNG BỘ!');
    console.log('======================================================');
    console.log(' 1. Khách hàng: customer@gmail.com / 123456');
    console.log(' 2. Quản trị:   admin@gmail.com / 123456');
    console.log(' 3. Nhân viên:  staff@gmail.com / 123456');
    console.log('======================================================');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi nạp dữ liệu seed:', error);
    process.exit(1);
  }
}

seedData();