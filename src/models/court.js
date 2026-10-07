const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    courtType: {
        type: String,
        enum: ['SINGLE', 'DOUBLE', 'STANDARD'],
        default: 'STANDARD'
    },
    surfaceType: {
        type: String,
        enum: ['PVC', 'WOOD', 'RUBBER'],
        default: 'PVC'
    },
    openTime: {
        type: String,
        default: '06:00'
    },
    closeTime: {
        type: String,
        default: '23:00'
    },
    priceTableId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PriceTable',
        required: true
    },
    operationalStatus: {
        type: String,
        enum: ['AVAILABLE', 'IN_USE', 'CLEANING', 'MAINTENANCE'],
        default: 'AVAILABLE'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Court', courtSchema, 'Court');