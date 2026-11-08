const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema({
  courtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Court',
    required: true
  },
  timeSlotId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeSlot'
  },
  dayType: {
    type: String,
    enum: ['WEEKDAY', 'WEEKEND', 'HOLIDAY'],
    default: 'WEEKDAY'
  },
  timeSlot: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  effectiveFrom: {
    type: Date,
    default: Date.now
  },
  effectiveTo: {
    type: Date
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

module.exports = mongoose.model('Price', priceSchema, 'Price');
