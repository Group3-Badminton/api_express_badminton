const mongoose = require('mongoose');

const priceTableSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    standardRatePerHour: {
        type: Number,
        required: true
    }, // Giá giờ thường (VND/h)
    peakRatePerHour: {
        type: Number,
        required: true
    },     // Giá giờ cao điểm (VND/h)
    peakHourStart: {
        type: String,
        default: '17:00'
    },     // Khung giờ bắt đầu cao điểm
    peakHourEnd: {
        type: String,
        default: '21:00'
    },       // Khung giờ kết thúc cao điểm
    weekendSurchargePercent: {
        type: Number,
        default: 0
    }, // Phụ thu cuối tuần (%)
    minDurationMinutes: {
        type: Number,
        default: 60
    },     // Thời gian đặt tối thiểu (phút)
    timeIncrementMinutes: {
        type: Number,
        default: 30
    },   // Bước nhảy thời gian (phút)
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('PriceTable', priceTableSchema, 'PriceTable');