const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema({
  courtName: {
    type: String,
    required: true,
    trim: true
  },
  courtType: {
    type: String,
    default: 'Sân Thảm Tiêu Chuẩn',
    trim: true
  },
  location: {
    type: String,
    default: 'Khu vực A',
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

module.exports = mongoose.model('Court', courtSchema, 'Court');
