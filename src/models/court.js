
const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema(
  {
    courtName: {
      type: String,
      trim: true,
      maxlength: 100
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100
    },

    courtType: {
      type: String,
      default: 'Sân Thảm Tiêu Chuẩn'
    },

    location: {
      type: String,
      default: ''
    },

    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    },

    operationalStatus: {
      type: String,
      enum: ['AVAILABLE', 'IN_USE', 'CLEANING', 'MAINTENANCE'],
      default: 'AVAILABLE'
    },

    bookingVersion: {
      type: Number,
      default: 0
    },

    bookingLockToken: {
      type: String,
      default: undefined
    },

    bookingLockUntil: {
      type: Date,
      default: undefined
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },

    openingTime: {
      type: String,
      default: '05:00'
    },

    closingTime: {
      type: String,
      default: '23:00'
    }
  },
  {
    timestamps: true,
    strict: false
  }
);

// Đồng bộ name và courtName để tương thích với code hiện tại.
courtSchema.pre('validate', function () {
  if (!this.name && this.courtName) {
    this.name = this.courtName;
  }

  if (!this.courtName && this.name) {
    this.courtName = this.name;
  }
});

// Tên sân độc nhất, không phân biệt chữ hoa và chữ thường.
courtSchema.index(
  { name: 1 },
  {
    unique: true,
    collation: { locale: 'vi', strength: 2 }
  }
);

module.exports = mongoose.model('Court', courtSchema, 'Court');
