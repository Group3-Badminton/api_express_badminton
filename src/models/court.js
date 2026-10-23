const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema({
  courtName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  name: {
    type: String,
    trim: true
  },
  courtType: {
    type: String,
    default: 'Sân Tiêu Chuẩn'
  },
  location: {
    type: String,
    default: 'Trong nhà'
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE'
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
}, { timestamps: true, strict: false });

module.exports = mongoose.model('Court', courtSchema, 'Court');
