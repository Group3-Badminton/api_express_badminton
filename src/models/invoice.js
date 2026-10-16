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
  paymentMethod: {
    type: String,
    enum: ['CASH', 'TRANSFER', 'VIETQR', 'ONLINE'],
    default: 'CASH'
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
  status: {
    type: String,
    enum: ['ACTIVE', 'CANCELLED'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema, 'Invoice');
