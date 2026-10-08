const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('./src/models/user');

dotenv.config();

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối DB để nạp tài khoản mẫu...');

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
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi nạp dữ liệu:', error);
    process.exit(1);
  }
}

seedData();