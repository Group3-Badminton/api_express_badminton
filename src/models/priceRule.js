const mongoose = require('mongoose');

const priceRuleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tên quy tắc giá không được để trống'],
      trim: true
    },
    courtType: {
      type: String,
      required: [true, 'Loại sân áp dụng không được để trống'],
      enum: {
        values: ['STANDARD', 'VIP', 'PREMIUM', 'ALL'],
        message: 'Loại sân không hợp lệ (phải là STANDARD, VIP, PREMIUM hoặc ALL)'
      },
      default: 'ALL'
    },
    daysOfWeek: {
      type: [Number],
      required: [true, 'Ngày áp dụng trong tuần không được để trống'],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0 && val.every((d) => d >= 0 && d <= 6);
        },
        message: 'Ngày áp dụng phải là mảng các số từ 0 (Chủ nhật) đến 6 (Thứ bảy)'
      }
    },
    startTime: {
      type: String,
      required: [true, 'Giờ bắt đầu không được để trống'],
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Giờ bắt đầu không đúng định dạng HH:mm (VD: 06:00)']
    },
    endTime: {
      type: String,
      required: [true, 'Giờ kết thúc không được để trống'],
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Giờ kết thúc không đúng định dạng HH:mm (VD: 17:00)']
    },
    pricePerHour: {
      type: Number,
      required: [true, 'Giá thuê theo giờ không được để trống'],
      min: [0, 'Giá thuê không được nhỏ hơn 0']
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    },
    description: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('PriceRule', priceRuleSchema, 'PriceRule');
