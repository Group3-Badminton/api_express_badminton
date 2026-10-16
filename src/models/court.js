const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE'
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  openingTime: {
    type: String,
    default: '05:00',
    match: /^([01]\d|2[0-3]):([0-5]\d)$/
  },
  closingTime: {
    type: String,
    default: '23:00',
    match: /^([01]\d|2[0-3]):([0-5]\d)$/
  }
}, { timestamps: true });

// Tên sân độc nhất (không phân biệt chữ hoa thường)
courtSchema.index({ name: 1 }, { unique: true, collation: { locale: 'vi', strength: 2 } });

module.exports = mongoose.model('Court', courtSchema, 'Court');
