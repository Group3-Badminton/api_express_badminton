const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 50
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    discountType: {
      type: String,
      enum: ['PERCENTAGE', 'FIXED_AMOUNT'],
      default: 'PERCENTAGE',
      required: true
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0
    },
    maxDiscountAmount: {
      type: Number,
      default: null,
      min: 0
    },
    minInvoiceAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    usageLimit: {
      type: Number,
      default: null,
      min: 1
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    applicableCourtTypes: {
      type: [String],
      default: ['ALL']
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff'
    }
  },
  {
    timestamps: true
  }
);

voucherSchema.index({ status: 1 });
voucherSchema.index({ startDate: 1, endDate: 1 });
voucherSchema.index({ createdAt: -1 });

// CLEAN CODE: Hỗ trợ tương thích ngược cho voucherCode, voucherName và maxDiscount từ DB
voucherSchema.virtual('voucherCode').get(function () {
  return this.code;
});

voucherSchema.virtual('voucherName').get(function () {
  return this.name;
});

voucherSchema.virtual('maxDiscount').get(function () {
  return this.maxDiscountAmount;
});

voucherSchema.set('toJSON', { virtuals: true });
voucherSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Voucher', voucherSchema, 'Voucher');
