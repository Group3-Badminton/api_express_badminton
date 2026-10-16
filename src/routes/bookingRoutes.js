const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middlewares/authMiddleware');

// 1. Danh sách sân phục vụ bộ lọc và trang đặt sân
router.get('/courts', authMiddleware, bookingController.getCourts);

// 2. Danh sách khung giờ cố định
router.get('/time-slots', authMiddleware, bookingController.getTimeSlots);

// 3. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày
router.get('/availability', authMiddleware, bookingController.getCourtAvailability);

// 4. Kiểm tra và áp dụng mã giảm giá (Voucher)
router.post('/validate-voucher', authMiddleware, bookingController.validateVoucher);

// 5. Lấy danh sách bookings (tìm kiếm, lọc, phân trang, thống kê)
router.get('/', authMiddleware, bookingController.getAllBookings);

// Danh sách khách hàng phục vụ nhân viên đặt sân
router.get('/customers', authMiddleware, bookingController.getCustomers);

// 6. Lấy chi tiết đơn đặt sân theo ID
router.get('/:id', authMiddleware, bookingController.getBookingById);

// 7. Cập nhật trạng thái đơn đặt sân
router.patch('/:id/status', authMiddleware, bookingController.updateBookingStatus);

// AF1: Thay đổi thông tin đặt sân (Change Booking Information)
router.patch('/:id/change-info', authMiddleware, bookingController.changeBookingInfo);

// AF2: Từ chối yêu cầu đặt sân (Reject Booking)
router.patch('/:id/reject', authMiddleware, bookingController.rejectBooking);

// 8. Tạo mới đơn đặt sân
router.post('/', authMiddleware, bookingController.createBooking);

module.exports = router;
