const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('./src/models/user');
const PriceRule = require('./src/models/priceRule');

dotenv.config();

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối DB để nạp dữ liệu mẫu...');

    // Xóa user cũ
    await User.deleteMany({});

    // Tạo mật khẩu mã hóa 123456
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('123456', salt);

    // Tạo tài khoản mẫu
    await User.create([
      {
        email: 'customer@gmail.com',
        password: hashedPassword,
        fullName: 'Nguyễn Văn Khách',
        phone: '0901234567',
        role: 'CUSTOMER',
        status: 'ACTIVE'
      },
      {
        email: 'admin@gmail.com',
        password: hashedPassword,
        fullName: 'Quản Trị Viên Sân',
        phone: '0909999999',
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    ]);

    console.log('✅ Đã tạo thành công 2 Tài khoản mẫu:');
    console.log('   1. Khách hàng: customer@gmail.com / 123456');
    console.log('   2. Quản trị viên: admin@gmail.com / 123456');

    // Nạp quy tắc giá mẫu ban đầu nếu chưa có
    await PriceRule.deleteMany({});
    await PriceRule.create([
      {
        name: 'Sân Tiêu Chuẩn - Giờ thường ngày trong tuần',
        courtType: 'STANDARD',
        daysOfWeek: [1, 2, 3, 4, 5], // Thứ 2 đến Thứ 6
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
        daysOfWeek: [6, 0], // Thứ 7 và Chủ nhật
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

    console.log('✅ Đã tạo thành công 6 Quy tắc giá mẫu (PriceRule)');
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi nạp dữ liệu:', error);
    process.exit(1);
  }
}

seedData();