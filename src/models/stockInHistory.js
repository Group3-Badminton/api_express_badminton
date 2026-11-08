const mongoose = require('mongoose');

const stockInHistorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    costPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    stockBefore: {
      type: Number,
      required: true,
      min: 0
    },
    stockAfter: {
      type: Number,
      required: true,
      min: 0
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true
    },
    requestId: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

stockInHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('StockInHistory', stockInHistorySchema, 'StockInHistory');
