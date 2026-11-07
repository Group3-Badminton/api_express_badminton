const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email không được để trống!'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email không hợp lệ!']
  },
  password: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: [true, 'Số điện thoại không được để trống!'],
    trim: true,
    match: [/^0[35789]\d{8}$/, 'Số điện thoại không hợp lệ (phải gồm 10 chữ số, bắt đầu bằng 03, 05, 07, 08, 09)!']
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  role: {
    type: String,
    enum: ['ADMIN', 'STAFF'],
    default: 'STAFF'
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE'
  },
  resetOtp: {
    type: String,
    default: null
  },
  resetOtpExpiry: {
    type: Date,
    default: null
  }
}, { timestamps: true });

staffSchema.virtual('userId').get(function () {
  return this._id;
});

module.exports = mongoose.model('Staff', staffSchema, 'Staff');
