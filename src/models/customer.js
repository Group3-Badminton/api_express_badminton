const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Định dạng Email không hợp lệ!']
  },
  password: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    trim: true,
    match: [/^0[35789]\d{8}$/, 'Số điện thoại không đúng định dạng hợp lệ (10 chữ số, đầu số 03, 05, 07, 08, 09)!']
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  role: {
    type: String,
    default: 'CUSTOMER',
    immutable: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING_VERIFICATION'],
    default: 'ACTIVE'
  },
  lockReason: {
    type: String,
    default: ''
  },
  lockedAt: {
    type: Date,
    default: null
  },
  lockedByBookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null
  },
  bookingCancellationHistory: [
    {
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
      },
      bookingCode: {
        type: String,
        default: ''
      },
      cancelledAt: {
        type: Date,
        required: true
      },
      previousStatus: {
        type: String,
        required: true
      },
      itemId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      scope: {
        type: String,
        enum: ['ITEM', 'BOOKING'],
        default: 'BOOKING'
      },
      countsTowardMonthlyLimit: {
        type: Boolean,
        default: false
      }
    }
  ],
  accountLockHistory: [
    {
      action: {
        type: String,
        enum: ['LOCKED', 'UNLOCKED'],
        required: true
      },
      reason: {
        type: String,
        default: ''
      },
      occurredAt: {
        type: Date,
        required: true
      },
      performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff',
        default: null
      },
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null
      }
    }
  ],
  bookingCancellationVersion: {
    type: Number,
    default: 0
  },
  cancellationLockToken: {
    type: String,
    default: null
  },
  cancellationLockUntil: {
    type: Date,
    default: null
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

customerSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } }
  }
);

customerSchema.virtual('userId').get(function () {
  return this._id;
});

module.exports = mongoose.model('Customer', customerSchema, 'Customer');
