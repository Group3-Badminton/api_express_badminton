const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuth = require('../middlewares/optionalAuthMiddleware');

// 1. Danh sách sân phục vụ bộ lọc và trang đặt sân (cho phép xem công khai)
router.get('/courts', optionalAuth, bookingController.getCourts);

// 2. Danh sách khung giờ cố định (cho phép xem công khai)
router.get('/time-slots', optionalAuth, bookingController.getTimeSlots);

// 3. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày (cho phép xem công khai)
router.get('/availability', optionalAuth, bookingController.getCourtAvailability);

// 4. Kiểm tra và áp dụng mã giảm giá (Voucher)
router.post('/validate-voucher', optionalAuth, bookingController.validateVoucher);

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

// 8. Tạo mới đơn đặt sân (hỗ trợ cả khách đăng nhập lẫn khách vãng lai)
router.post('/', optionalAuth, bookingController.createBooking);

module.exports = router;
