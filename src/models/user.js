const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        default: ''
    },
    address: {
        type: String,
        default: ''
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
    resetOtp: {
        type: String,
        default: null
    },
    resetOtpExpiry: {
        type: Date,
        default: null
    }
}, { timestamps: true });

userSchema.index(
    { email: 1 },
    {
        unique: true,
        partialFilterExpression: { email: { $type: 'string' } }
    }
);

module.exports = mongoose.model('User', userSchema, 'User');