const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true,
        unique: true
    },
    password: {
        type: String,
        default: null
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    role: {
        type: String,
        enum: ['ADMIN', 'STAFF', 'CUSTOMER'],
        default: 'CUSTOMER'
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE', 'LOCKED', 'PENDING_VERIFICATION'],
        default: 'ACTIVE'
    },
    address: {
        type: String,
        default: ''
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

module.exports = mongoose.model('User', userSchema, 'User');
