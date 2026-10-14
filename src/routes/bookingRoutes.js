const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middlewares/authMiddleware');

// Lấy danh sách sân phục vụ bộ lọc (cho cả trang quản lý và người dùng)
router.get('/courts', authMiddleware, bookingController.getCourts);

// Lấy danh sách bookings với tìm kiếm, phân trang và thống kê
router.get('/', authMiddleware, bookingController.getAllBookings);

// Lấy chi tiết đơn đặt sân theo ID
router.get('/:id', authMiddleware, bookingController.getBookingById);

// Cập nhật trạng thái đơn đặt sân
router.patch('/:id/status', authMiddleware, bookingController.updateBookingStatus);

// Tạo mới đơn đặt sân
router.post('/', authMiddleware, bookingController.createBooking);

module.exports = router;
