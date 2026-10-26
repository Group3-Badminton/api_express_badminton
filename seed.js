const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

// Import toàn bộ 12 Models thực tế của hệ thống
const User = require('./src/models/user');
const Court = require('./src/models/court');
const TimeSlot = require('./src/models/timeSlot');
const Price = require('./src/models/price');
const PriceRule = require('./src/models/priceRule');
const Voucher = require('./src/models/voucher');
const Product = require('./src/models/product');
const StockInHistory = require('./src/models/stockInHistory');
const Booking = require('./src/models/booking');
const PlayingSession = require('./src/models/playingSession');
const Invoice = require('./src/models/invoice');
const Notification = require('./src/models/notification');

dotenv.config();

async function seedData() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bad2';
    await mongoose.connect(mongoUri, { retryWrites: false });
    console.log(`✅ Đã kết nối cơ sở dữ liệu MongoDB: ${mongoose.connection.name}`);

    // 1. Dọn dẹp an toàn các collection
    await Promise.all([
      User.deleteMany({}),
      Court.deleteMany({}),
      TimeSlot.deleteMany({}),
      Price.deleteMany({}),
      PriceRule.deleteMany({}),
      Voucher.deleteMany({}),
      Product.deleteMany({}),
      StockInHistory.deleteMany({}),
      Booking.deleteMany({}),
      PlayingSession.deleteMany({}),
      Invoice.deleteMany({}),
      Notification.deleteMany({})
    ]);
    console.log('🗑️ Đã làm sạch dữ liệu cũ để đồng bộ dữ liệu mới chuẩn hóa.');

    // 2. Mã hóa mật khẩu mẫu chung (123456)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);

    // 3. Tạo USERS (ADMIN, STAFF, CUSTOMER)
    const users = await User.create([
      {
        fullName: 'Quản Trị Viên',
        email: 'admin@gmail.com',
        password: hashedPassword,
        phone: '0909999999',
        address: '456 Lê Lợi, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'ADMIN'
      },
      {
        fullName: 'Nhân Viên Thu Ngân',
        email: 'staff@gmail.com',
        password: hashedPassword,
        phone: '0908888888',
        address: '789 Trần Hưng Đạo, Cần Thơ',
        status: 'ACTIVE',
        role: 'STAFF'
      },
      {
        fullName: 'Nguyễn Văn Khách',
        email: 'customer@gmail.com',
        password: hashedPassword,
        phone: '0901234567',
        address: '123 Đường 3/2, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER',
        bookingCancellationHistory: []
      },
      {
        fullName: 'Trần Thị Lan',
        email: 'lan.tran@gmail.com',
        password: hashedPassword,
        phone: '0912345678',
        address: '88 Nguyễn Trãi, Ninh Kiều, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER',
        bookingCancellationHistory: []
      },
      {
        fullName: 'Lê Hoàng Long',
        email: 'long.le@gmail.com',
        password: hashedPassword,
        phone: '0933456789',
        address: '45 Mậu Thân, Cần Thơ',
        status: 'ACTIVE',
        role: 'CUSTOMER',
        bookingCancellationHistory: []
      }
    ]);
    console.log('👤 Đã tạo thành công 5 tài khoản User (ADMIN, STAFF, CUSTOMER).');

    const adminUser = users.find((u) => u.role === 'ADMIN');
    const staffUser = users.find((u) => u.role === 'STAFF');
    const customer1 = users.find((u) => u.email === 'customer@gmail.com');
    const customer2 = users.find((u) => u.email === 'lan.tran@gmail.com');
    const customer3 = users.find((u) => u.email === 'long.le@gmail.com');

    // 4. Tạo SÂN THI ĐẤU (COURT)
    const courts = await Court.create([
      {
        name: 'Sân Cầu Lông Số 1',
        courtName: 'Sân Cầu Lông Số 1',
        courtType: 'STANDARD',
        location: 'Khu vực A (Trong nhà)',
        description: 'Sân trong nhà thoáng mát, ánh sáng chuẩn thi đấu.',
        status: 'ACTIVE',
        operationalStatus: 'AVAILABLE',
        openingTime: '05:00',
        closingTime: '23:00'
      },
      {
        name: 'Sân Cầu Lông Số 2',
        courtName: 'Sân Cầu Lông Số 2',
        courtType: 'VIP',
        location: 'Khu vực B (Trong nhà)',
        description: 'Sân sàn gỗ chuyên nghiệp, chống trơn trượt.',
        status: 'ACTIVE',
        operationalStatus: 'AVAILABLE',
        openingTime: '05:00',
        closingTime: '23:00'
      },
      {
        name: 'Sân Cầu Lông Số 3',
        courtName: 'Sân Cầu Lông Số 3',
        courtType: 'PREMIUM',
        location: 'Khu vực A (Trong nhà)',
        description: 'Sân đạt chuẩn giải đấu quốc gia BWF, có khán đài mini.',
        status: 'ACTIVE',
        operationalStatus: 'AVAILABLE',
        openingTime: '05:00',
        closingTime: '23:00'
      },
      {
        name: 'Sân Cầu Lông Số 4',
        courtName: 'Sân Cầu Lông Số 4',
        courtType: 'STANDARD',
        location: 'Khu vực C (Tiêu chuẩn)',
        description: 'Sân thảm tiêu chuẩn, không gian thoáng đãng.',
        status: 'ACTIVE',
        operationalStatus: 'AVAILABLE',
        openingTime: '05:00',
        closingTime: '23:00'
      }
    ]);
    console.log('🏸 Đã tạo thành công 4 Sân cầu lông (Courts).');

    // 5. Tạo KHUNG GIỜ THI ĐẤU (TIME_SLOT)
    const timeSlots = await TimeSlot.create([
      { startTime: '06:00', endTime: '08:00', label: '06:00 - 08:00 (Sáng sớm)', status: 'ACTIVE' },
      { startTime: '08:00', endTime: '10:00', label: '08:00 - 10:00 (Sáng)', status: 'ACTIVE' },
      { startTime: '10:00', endTime: '12:00', label: '10:00 - 12:00 (Trưa)', status: 'ACTIVE' },
      { startTime: '14:00', endTime: '16:00', label: '14:00 - 16:00 (Chiều)', status: 'ACTIVE' },
      { startTime: '16:00', endTime: '18:00', label: '16:00 - 18:00 (Chiều muộn)', status: 'ACTIVE' },
      { startTime: '17:00', endTime: '19:00', label: '17:00 - 19:00 (Giờ vàng)', status: 'ACTIVE' },
      { startTime: '18:00', endTime: '20:00', label: '18:00 - 20:00 (Giờ vàng tối)', status: 'ACTIVE' },
      { startTime: '19:00', endTime: '21:00', label: '19:00 - 21:00 (Giờ vàng đêm)', status: 'ACTIVE' },
      { startTime: '20:00', endTime: '22:00', label: '20:00 - 22:00 (Tối muộn)', status: 'ACTIVE' }
    ]);
    console.log('⏰ Đã tạo thành công 9 Khung giờ chuẩn (TimeSlots).');

    // 6. Tạo QUY TẮC GIÁ (PRICE_RULE)
    await PriceRule.create([
      {
        name: 'Sân Tiêu Chuẩn - Giờ thường ngày trong tuần',
        courtType: 'STANDARD',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '06:00',
        endTime: '17:00',
        pricePerHour: 80000,
        status: 'ACTIVE',
        description: 'Áp dụng cho giờ thường từ Thứ Hai đến Thứ Sáu'
      },
      {
        name: 'Sân Tiêu Chuẩn - Giờ vàng buổi tối',
        courtType: 'STANDARD',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '17:00',
        endTime: '22:00',
        pricePerHour: 130000,
        status: 'ACTIVE',
        description: 'Khung giờ cao điểm buổi tối các ngày trong tuần'
      },
      {
        name: 'Sân Tiêu Chuẩn - Cuối tuần',
        courtType: 'STANDARD',
        daysOfWeek: [6, 0],
        startTime: '06:00',
        endTime: '22:00',
        pricePerHour: 140000,
        status: 'ACTIVE',
        description: 'Áp dụng cả ngày Thứ Bảy và Chủ Nhật'
      },
      {
        name: 'Sân VIP - Giờ thường ngày trong tuần',
        courtType: 'VIP',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '06:00',
        endTime: '17:00',
        pricePerHour: 100000,
        status: 'ACTIVE',
        description: 'Sân VIP giờ hành chính'
      },
      {
        name: 'Sân VIP - Giờ vàng buổi tối',
        courtType: 'VIP',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '17:00',
        endTime: '22:00',
        pricePerHour: 150000,
        status: 'ACTIVE',
        description: 'Sân VIP khung giờ vàng buổi tối'
      },
      {
        name: 'Sân VIP - Cuối tuần',
        courtType: 'VIP',
        daysOfWeek: [6, 0],
        startTime: '06:00',
        endTime: '22:00',
        pricePerHour: 170000,
        status: 'ACTIVE',
        description: 'Sân VIP cả ngày Thứ Bảy và Chủ Nhật'
      },
      {
        name: 'Sân Thi Đấu - Giờ thường ngày trong tuần',
        courtType: 'PREMIUM',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '06:00',
        endTime: '17:00',
        pricePerHour: 130000,
        status: 'ACTIVE',
        description: 'Sân thi đấu giờ thường'
      },
      {
        name: 'Sân Thi Đấu - Giờ vàng buổi tối',
        courtType: 'PREMIUM',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '17:00',
        endTime: '22:00',
        pricePerHour: 190000,
        status: 'ACTIVE',
        description: 'Sân thi đấu giờ vàng'
      },
      {
        name: 'Sân Thi Đấu - Cuối tuần chuyên nghiệp',
        courtType: 'PREMIUM',
        daysOfWeek: [6, 0],
        startTime: '06:00',
        endTime: '22:00',
        pricePerHour: 210000,
        status: 'ACTIVE',
        description: 'Sân chuẩn thi đấu quốc tế BWF cho các giải đấu cuối tuần'
      }
    ]);
    console.log('📊 Đã tạo thành công 9 Quy tắc bảng giá (PriceRules).');

    // 7. Tạo BẢNG GIÁ CHI TIẾT (PRICE) theo Sân và Khung giờ
    const priceRecords = [];
    const effectiveFrom = new Date('2026-01-01');
    const effectiveTo = new Date('2030-12-31');

    for (const c of courts) {
      const isVip = c.courtType === 'VIP';
      const isPremium = c.courtType === 'PREMIUM';

      const baseRateWeekday = isPremium ? 130000 : (isVip ? 100000 : 80000);
      const peakRateWeekday = isPremium ? 190000 : (isVip ? 150000 : 130000);
      const weekendRate = isPremium ? 210000 : (isVip ? 170000 : 140000);

      for (const slot of timeSlots) {
        const isPeak = slot.startTime >= '17:00';
        const [sh] = slot.startTime.split(':').map(Number);
        const [eh] = slot.endTime.split(':').map(Number);
        const durationHours = Math.max(1, eh - sh);

        // Giá ngày thường (WEEKDAY)
        priceRecords.push({
          courtId: c._id,
          timeSlotId: slot._id,
          dayType: 'WEEKDAY',
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          price: isPeak ? peakRateWeekday : baseRateWeekday,
          effectiveFrom,
          effectiveTo,
          status: 'ACTIVE'
        });

        // Giá cuối tuần (WEEKEND)
        priceRecords.push({
          courtId: c._id,
          timeSlotId: slot._id,
          dayType: 'WEEKEND',
          timeSlot: `${slot.startTime} - ${slot.endTime}`,
          price: weekendRate,
          effectiveFrom,
          effectiveTo,
          status: 'ACTIVE'
        });
      }
    }
    await Price.create(priceRecords);
    console.log(`💲 Đã tạo thành công ${priceRecords.length} Bản ghi giá chi tiết (Prices).`);

    // 8. Tạo VOUCHERS (MÃ GIẢM GIÁ)
    const vouchers = await Voucher.create([
      {
        code: 'GIAM10',
        name: 'Giảm 10% cho đơn đặt sân',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountAmount: 50000,
        minInvoiceAmount: 50000,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2030-12-31'),
        usageLimit: 100,
        usedCount: 5,
        status: 'ACTIVE'
      },
      {
        code: 'CHAOMUNG',
        name: 'Chào mừng khách hàng mới',
        discountType: 'FIXED_AMOUNT',
        discountValue: 20000,
        maxDiscountAmount: 20000,
        minInvoiceAmount: 80000,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2030-12-31'),
        usageLimit: 200,
        usedCount: 12,
        status: 'ACTIVE'
      },
      {
        code: 'VIPBADMINTON',
        name: 'Ưu đãi hội viên VIP',
        discountType: 'PERCENTAGE',
        discountValue: 15,
        maxDiscountAmount: 100000,
        minInvoiceAmount: 150000,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2030-12-31'),
        usageLimit: 50,
        usedCount: 2,
        status: 'ACTIVE'
      }
    ]);
    console.log('🎟️ Đã tạo thành công 3 Mã giảm giá (Vouchers).');

    // 9. Tạo SẢN PHẨM & NHẬP KHO (PRODUCT & STOCK_IN_HISTORY)
    const products = await Product.create([
      {
        name: 'Nước khoáng Lavie 500ml',
        price: 10000,
        description: 'Nước khoáng thiên nhiên đóng chai 500ml',
        stockQuantity: 100,
        category: 'DRINK',
        unit: 'chai',
        status: 'ACTIVE'
      },
      {
        name: 'Nước tăng lực RedBull Thái',
        price: 20000,
        description: 'Nước tăng lực lon vàng chính hãng',
        stockQuantity: 80,
        category: 'DRINK',
        unit: 'lon',
        status: 'ACTIVE'
      },
      {
        name: 'Nước thể thao Pocari Sweat 500ml',
        price: 18000,
        description: 'Bổ sung ion và khoáng chất nhanh chóng',
        stockQuantity: 60,
        category: 'DRINK',
        unit: 'chai',
        status: 'ACTIVE'
      },
      {
        name: 'Quả cầu lông Yonex Aerosensa 50',
        price: 45000,
        description: 'Cầu lông thi đấu cao cấp chuẩn BWF',
        stockQuantity: 150,
        category: 'ACCESSORY',
        unit: 'quả',
        status: 'ACTIVE'
      },
      {
        name: 'Quấn cán vợt Yonex AC102EX',
        price: 35000,
        description: 'Quấn cán thấm hút mồ hôi êm tay',
        stockQuantity: 50,
        category: 'ACCESSORY',
        unit: 'cái',
        status: 'ACTIVE'
      },
      {
        name: 'Cho thuê vợt cầu lông Yonex Carbon',
        price: 30000,
        description: 'Vợt căng sẵn 10.5kg chất lượng tốt',
        stockQuantity: 20,
        category: 'RENTAL',
        unit: 'cây/ca',
        status: 'ACTIVE'
      }
    ]);
    console.log('📦 Đã tạo thành công 6 Sản phẩm (Products).');

    // Tạo lịch sử nhập kho ban đầu
    const stockHistory = products.map((p) => ({
      productId: p._id,
      quantity: p.stockQuantity,
      costPrice: Math.round(p.price * 0.6),
      stockBefore: 0,
      stockAfter: p.stockQuantity,
      note: 'Nhập kho khởi tạo hệ thống',
      performedBy: adminUser._id
    }));
    await StockInHistory.create(stockHistory);
    console.log('📜 Đã ghi nhận lịch sử nhập kho ban đầu (StockInHistory).');

    // 10. Tạo BOOKINGS (ĐƠN ĐẶT SÂN)
    const today = new Date();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const formatDt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    const bookings = await Booking.create([
      {
        bookingCode: `BK${formatDt(today)}1001`,
        customerId: customer1._id,
        courtId: courts[0]._id,
        voucherId: null,
        bookingDate: today,
        startTime: '08:00',
        endTime: '10:00',
        price: 160000,
        discount: 0,
        totalAmount: 160000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        items: [
          {
            courtId: courts[0]._id,
            courtName: courts[0].name,
            courtType: courts[0].courtType,
            location: courts[0].location,
            bookingDate: today,
            status: 'ACTIVE',
            startTime: '08:00',
            endTime: '10:00',
            durationMinutes: 120,
            durationHours: 2,
            price: 160000,
            intervals: [
              {
                startTime: '08:00',
                endTime: '10:00',
                durationMinutes: 120,
                durationHours: 2,
                priceType: 'Giờ thường',
                hourlyRate: 80000,
                amount: 160000
              }
            ]
          }
        ],
        note: 'Khách quen đặt sân định kỳ'
      },
      {
        bookingCode: `BK${formatDt(today)}1002`,
        customerId: customer2._id,
        courtId: courts[1]._id,
        voucherId: vouchers[0]._id,
        bookingDate: today,
        startTime: '17:00',
        endTime: '19:00',
        price: 300000,
        discount: 30000,
        totalAmount: 270000,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        items: [
          {
            courtId: courts[1]._id,
            courtName: courts[1].name,
            courtType: courts[1].courtType,
            location: courts[1].location,
            bookingDate: today,
            status: 'ACTIVE',
            startTime: '17:00',
            endTime: '19:00',
            durationMinutes: 120,
            durationHours: 2,
            price: 300000,
            intervals: [
              {
                startTime: '17:00',
                endTime: '19:00',
                durationMinutes: 120,
                durationHours: 2,
                priceType: 'Giờ vàng VIP',
                hourlyRate: 150000,
                amount: 300000
              }
            ]
          }
        ],
        note: 'Áp dụng mã GIAM10 thành công'
      },
      {
        bookingCode: `BK${formatDt(tomorrow)}2001`,
        customerId: customer3._id,
        courtId: courts[2]._id,
        voucherId: null,
        bookingDate: tomorrow,
        startTime: '18:00',
        endTime: '20:00',
        price: 380000,
        discount: 0,
        totalAmount: 380000,
        status: 'PENDING_APPROVAL',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        items: [
          {
            courtId: courts[2]._id,
            courtName: courts[2].name,
            courtType: courts[2].courtType,
            location: courts[2].location,
            bookingDate: tomorrow,
            status: 'ACTIVE',
            startTime: '18:00',
            endTime: '20:00',
            durationMinutes: 120,
            durationHours: 2,
            price: 380000,
            intervals: [
              {
                startTime: '18:00',
                endTime: '20:00',
                durationMinutes: 120,
                durationHours: 2,
                priceType: 'Giờ vàng thi đấu',
                hourlyRate: 190000,
                amount: 380000
              }
            ]
          }
        ],
        note: 'Đơn chờ Admin/Staff duyệt'
      },
      {
        bookingCode: `BK${formatDt(dayAfter)}3001`,
        customerId: customer1._id,
        courtId: courts[0]._id,
        voucherId: null,
        bookingDate: dayAfter,
        startTime: '14:00',
        endTime: '16:00',
        price: 320000,
        discount: 0,
        totalAmount: 320000,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        paymentMethod: 'CASH',
        items: [
          {
            courtId: courts[0]._id,
            courtName: courts[0].name,
            courtType: courts[0].courtType,
            location: courts[0].location,
            bookingDate: dayAfter,
            status: 'ACTIVE',
            startTime: '14:00',
            endTime: '16:00',
            durationMinutes: 120,
            durationHours: 2,
            price: 160000,
            intervals: []
          },
          {
            courtId: courts[3]._id,
            courtName: courts[3].name,
            courtType: courts[3].courtType,
            location: courts[3].location,
            bookingDate: dayAfter,
            status: 'ACTIVE',
            startTime: '14:00',
            endTime: '16:00',
            durationMinutes: 120,
            durationHours: 2,
            price: 160000,
            intervals: []
          }
        ],
        note: 'Đơn đặt 2 sân cùng lúc'
      }
    ]);
    console.log('📑 Đã tạo thành công 4 Đơn đặt sân mẫu (Bookings).');

    // 11. Tạo CA CHƠI & HÓA ĐƠN (PLAYING_SESSION & INVOICE)
    const session1 = await PlayingSession.create({
      sessionCode: `SS-${Date.now().toString().slice(-6)}01`,
      bookingId: bookings[0]._id,
      courtId: courts[0]._id,
      staffId: staffUser._id,
      scheduledStartTime: new Date(today.setHours(8, 0, 0, 0)),
      scheduledEndTime: new Date(today.setHours(10, 0, 0, 0)),
      checkInAt: new Date(today.setHours(8, 2, 0, 0)),
      checkOutAt: new Date(today.setHours(10, 0, 0, 0)),
      status: 'COMPLETED',
      baseCourtFee: 160000,
      totalAmount: 190000,
      paymentStatus: 'PAID',
      rentalItems: [
        {
          productId: products[5]._id,
          productName: products[5].name,
          quantity: 1,
          unitPrice: 30000,
          returned: true
        }
      ]
    });

    await Invoice.create({
      invoiceCode: `INV-${Date.now().toString().slice(-6)}01`,
      playingSessionId: session1._id,
      staffId: staffUser._id,
      orderType: 'PLAYING_SESSION',
      customer: {
        customerId: customer1._id,
        fullName: customer1.fullName,
        phone: customer1.phone
      },
      sessionDetails: {
        courtName: courts[0].name,
        scheduledDurationHours: 2,
        baseCourtFee: 160000,
        consumableFee: 30000
      },
      items: [
        {
          productId: products[5]._id,
          productName: products[5].name,
          quantity: 1,
          unitPrice: 30000,
          subtotal: 30000
        }
      ],
      subtotal: 190000,
      discountAmount: 0,
      totalAmount: 190000,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID'
    });
    console.log('🧾 Đã tạo thành công Ca chơi (PlayingSession) và Hóa đơn (Invoice).');

    // 12. Tạo THÔNG BÁO (NOTIFICATION)
    await Notification.create([
      {
        recipientId: customer1._id,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_SUCCESS',
        title: 'Đặt sân thành công!',
        message: `Đơn đặt sân #${bookings[0].bookingCode} tại ${courts[0].name} đã được xác nhận.`,
        isRead: false
      },
      {
        recipientId: customer2._id,
        recipientType: 'CUSTOMER',
        type: 'BOOKING_SUCCESS',
        title: 'Áp dụng ưu đãi thành công!',
        message: `Đơn đặt sân #${bookings[1].bookingCode} đã được giảm 30.000đ từ mã GIAM10.`,
        isRead: true
      },
      {
        recipientId: staffUser._id,
        recipientType: 'STAFF',
        type: 'NEW_BOOKING_REQUEST',
        title: 'Yêu cầu đặt sân mới cần duyệt',
        message: `Khách hàng ${customer3.fullName} vừa gửi yêu cầu đặt sân #${bookings[2].bookingCode}.`,
        isRead: false
      }
    ]);
    console.log('🔔 Đã tạo thành công 3 Thông báo hệ thống (Notifications).');

    console.log('\n======================================================');
    console.log('🎉 ĐỒNG BỘ TOÀN BỘ CƠ SỞ DỮ LIỆU MONGODB THÀNH CÔNG!');
    console.log('======================================================');
    console.log('Tài khoản kiểm thử hệ thống:');
    console.log('1. Admin:    admin@gmail.com    / 123456');
    console.log('2. Staff:    staff@gmail.com    / 123456');
    console.log('3. Customer: customer@gmail.com / 123456');
    console.log('======================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi đồng bộ dữ liệu MongoDB:', error);
    process.exit(1);
  }
}

seedData();