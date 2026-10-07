const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const PriceTable = require('./src/models/priceTable');
const Court = require('./src/models/court');
const User = require('./src/models/user');

require('dotenv').config();
async function seedData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Đã kết nối DB để nạp dữ liệu mẫu...');

        // Xóa dữ liệu cũ nếu có
        await Court.deleteMany({});
        await PriceTable.deleteMany({});

        // 1. Tạo Bảng giá chuẩn 2026
        const standardPrice = await PriceTable.create({
            name: 'Bảng giá Tiêu Chuẩn 2026',
            standardRatePerHour: 80000,
            peakRatePerHour: 130000,
            peakHourStart: '17:00',
            peakHourEnd: '21:00',
            weekendSurchargePercent: 10,
            minDurationMinutes: 60,
            timeIncrementMinutes: 30,
            isActive: true
        });
        console.log('✅ Đã tạo Bảng giá vào MongoDB:', standardPrice.name);

        // 2. Tạo 3 Sân gắn với Bảng giá vừa tạo
        await Court.create([
            {
                name: 'Sân 01 - Thảm PVC Thi Đấu',
                courtType: 'STANDARD',
                surfaceType: 'PVC',
                openTime: '06:00',
                closeTime: '23:00',
                priceTableId: standardPrice._id,
                operationalStatus: 'AVAILABLE',
                isActive: true
            },
            {
                name: 'Sân 02 - Thảm Cao Su Premium',
                courtType: 'STANDARD',
                surfaceType: 'RUBBER',
                openTime: '06:00',
                closeTime: '23:00',
                priceTableId: standardPrice._id,
                operationalStatus: 'AVAILABLE',
                isActive: true
            },
            {
                name: 'Sân 03 - Sàn Gỗ Chống Trượt',
                courtType: 'STANDARD',
                surfaceType: 'WOOD',
                openTime: '06:00',
                closeTime: '23:00',
                priceTableId: standardPrice._id,
                operationalStatus: 'AVAILABLE',
                isActive: true
            }
        ]);

        console.log('✅ Đã tạo thành công 3 Sân vào MongoDB!');

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('123456', salt);
        await User.create([
            {
                email: 'customer@gmail.com',
                password: hashedPassword,
                fullName: 'Nguyễn Văn Khách',
                phone: '0901234567',
                role: 'CUSTOMER'
            },
            {
                email: 'admin@gmail.com',
                password: hashedPassword,
                fullName: 'Quản Trị Viên Sân',
                phone: '0909999999',
                role: 'ADMIN'
            }
        ]);
        console.log('✅ Đã tạo thành công: 3 Sân + 2 Tài khoản mẫu (customer@gmail.com & admin@gmail.com - pass: 123456)!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi khi nạp dữ liệu:', error);
        process.exit(1);
    }
}

seedData();