const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productName: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    default: 'Dụng cụ thể thao',
    trim: true
  },
  unit: {
    type: String,
    default: 'Cái',
    trim: true
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  stockQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema, 'Product');
