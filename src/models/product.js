const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000
    },
    stockQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    },
    category: {
      type: String,
      default: 'GENERAL',
      trim: true
    },
    unit: {
      type: String,
      default: 'cái',
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes để tối ưu tìm kiếm theo tên và lọc theo trạng thái, tồn kho, giá
productSchema.index({ name: 'text' });
productSchema.index({ status: 1 });
productSchema.index({ price: 1 });
productSchema.index({ stockQuantity: 1 });

module.exports = mongoose.model('Product', productSchema, 'Product');
