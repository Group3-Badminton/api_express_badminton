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
    lockReason: {
        type: String,
        default: ''
    },
    lockedAt: {
        type: Date,
        default: null
    },
    lockedByBookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null
    },
    bookingCancellationHistory: [
        {
            bookingId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Booking',
                required: true
            },
            bookingCode: {
                type: String,
                default: ''
            },
            cancelledAt: {
                type: Date,
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
    accountLockHistory: [
        {
            action: {
                type: String,
                enum: ['LOCKED', 'UNLOCKED'],
                required: true
            },
            reason: {
                type: String,
                default: ''
            },
            occurredAt: {
                type: Date,
                required: true
            },
            performedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                default: null
            },
            bookingId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Booking',
                default: null
            }
        }
    ],
    bookingCancellationVersion: {
        type: Number,
        default: 0
    },
    cancellationLockToken: {
        type: String,
        default: null
    },
    cancellationLockUntil: {
        type: Date,
        default: null
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

// Virtual field userId trỏ về _id để đảm bảo tính tương thích ngược
userSchema.virtual('userId').get(function () {
  return this._id;
});

module.exports = mongoose.model('User', userSchema, 'User');