const mongoose = require('mongoose');

const rentalItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  returned: {
    type: Boolean,
    default: false
  },
  damaged: {
    type: Boolean,
    default: false
  },
  compensationFee: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: true });

const extensionSchema = new mongoose.Schema({
  extendedMinutes: {
    type: Number,
    required: true // 30 hoặc 60
  },
  extendedFee: {
    type: Number,
    required: true,
    min: 0
  },
  extendedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const playingSessionSchema = new mongoose.Schema({
  sessionCode: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  courtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Court',
    required: true
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Thời gian
  scheduledStartTime: {
    type: Date,
    default: null
  },
  scheduledEndTime: {
    type: Date,
    default: null
  },
  checkInAt: {
    type: Date,
    default: Date.now
  },
  checkOutAt: {
    type: Date,
    default: null
  },
  startTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  actualDuration: {
    type: Number,
    default: 0
  },
  // Chi phí
  baseCourtFee: {
    type: Number,
    default: 0,
    min: 0
  },
  earlyCheckInMinutes: {
    type: Number,
    default: 0
  },
  earlyCheckInFee: {
    type: Number,
    default: 0,
    min: 0
  },
  overtimeMinutes: {
    type: Number,
    default: 0
  },
  overtimeFee: {
    type: Number,
    default: 0,
    min: 0
  },
  extensions: [extensionSchema],
  rentalItems: [rentalItemSchema],
  totalAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Trạng thái vận hành & Cảnh báo node-schedule
  isNearEnd: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'IN_PROGRESS'
  },
  note: {
    type: String,
    default: '',
    trim: true
  }
}, { timestamps: true });

module.exports = mongoose.model('PlayingSession', playingSessionSchema, 'PlayingSession');
