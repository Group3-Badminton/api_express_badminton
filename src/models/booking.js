const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  courtId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Court',
    required: true
  },
  voucherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voucher',
    default: null
  },
  bookingCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  bookingDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true,
    trim: true
  },
  endTime: {
    type: String,
    required: true,
    trim: true
  },
  price: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['PENDING', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REJECTED'],
    default: 'PENDING_APPROVAL'
  },
  paymentStatus: {
    type: String,
    enum: ['UNPAID', 'PAID', 'REFUNDED'],
    default: 'UNPAID'
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'TRANSFER', 'VIETQR', 'ONLINE'],
    default: 'CASH'
  },
  items: [
    {
      courtId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Court',
        required: true
      },
      courtName: {
        type: String,
        default: ''
      },
      courtType: {
        type: String,
        default: ''
      },
      location: {
        type: String,
        default: ''
      },
      bookingDate: {
        type: Date,
        default: undefined
      },
      status: {
        type: String,
        enum: ['ACTIVE', 'CANCELLED'],
        default: 'ACTIVE'
      },
      startTime: {
        type: String,
        required: true,
        trim: true
      },
      endTime: {
        type: String,
        required: true,
        trim: true
      },
      durationMinutes: {
        type: Number,
        default: 0
      },
      durationHours: {
        type: Number,
        default: 0
      },
      price: {
        type: Number,
        default: 0
      },
      intervals: [
        {
          startTime: String,
          endTime: String,
          durationMinutes: Number,
          durationHours: Number,
          priceType: String,
          hourlyRate: Number,
          amount: Number
        }
      ]
    }
  ],
  cancellationHistory: [
    {
      cancelledAt: {
        type: Date,
        required: true
      },
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'cancellationHistory.cancelledByModel',
        default: null
      },
      cancelledByModel: {
        type: String,
        enum: ['Staff', 'Customer'],
        default: 'Customer'
      },
      cancelledByRole: {
        type: String,
        enum: ['ADMIN', 'STAFF', 'CUSTOMER'],
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
  note: {
    type: String,
    default: ''
  },
  cancellationReason: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema, 'Booking');
