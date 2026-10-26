const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  playingSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PlayingSession',
    default: null
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  invoiceCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  orderType: {
    type: String,
    enum: ['PLAYING_SESSION', 'POS'],
    default: 'PLAYING_SESSION'
  },
  items: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      productName: {
        type: String,
        default: ''
      },
      quantity: {
        type: Number,
        default: 1,
        min: 1
      },
      unitPrice: {
        type: Number,
        default: 0,
        min: 0
      },
      subtotal: {
        type: Number,
        default: 0,
        min: 0
      }
    }
  ],
  customer: {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    fullName: {
      type: String,
      default: 'Khách lẻ'
    },
    phone: {
      type: String,
      default: ''
    }
  },
  sessionDetails: {
    courtName: { type: String, default: '' },
    scheduledDurationHours: { type: Number, default: 0 },
    baseCourtFee: { type: Number, default: 0 },
    earlyCheckInFee: { type: Number, default: 0 },
    overtimeFee: { type: Number, default: 0 },
    rentalDamageFee: { type: Number, default: 0 },
    extensionFee: { type: Number, default: 0 },
    consumableFee: { type: Number, default: 0 },
    prepaidDeposit: { type: Number, default: 0 }
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  voucherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Voucher',
    default: null
  },
  voucherCode: {
    type: String,
    default: ''
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'TRANSFER', 'VIETQR', 'ONLINE'],
    default: 'CASH'
  },
  cashReceived: {
    type: Number,
    default: 0,
    min: 0
  },
  changeAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  transactionReference: {
    type: String,
    default: ''
  },
  paymentStatus: {
    type: String,
    enum: ['UNPAID', 'PAID', 'REFUNDED'],
    default: 'PAID'
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  paidAt: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'CANCELLED'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

invoiceSchema.index({ orderType: 1 });
invoiceSchema.index({ paymentStatus: 1 });
invoiceSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema, 'Invoice');
