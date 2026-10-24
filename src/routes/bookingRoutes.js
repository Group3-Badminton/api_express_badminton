const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { authenticateUser, authorizeRole, optionalAuth } = require('../middlewares/authMiddleware');

// 1. Danh sách sân phục vụ bộ lọc và trang đặt sân (Công khai - Public)
router.get('/courts', bookingController.getCourts);

// 2. Danh sách khung giờ cố định (Công khai - Public)
router.get('/time-slots', bookingController.getTimeSlots);

// 3. Kiểm tra tình trạng khung giờ còn trống & Bảng giá (Công khai - Public)
router.get('/availability', bookingController.getCourtAvailability);

// 4. Kiểm tra và áp dụng mã giảm giá Voucher (Công khai - Public)
router.post('/validate-voucher', bookingController.validateVoucher);

// 5. Tính giá chi tiết cho từng sân và khung giờ (Công khai - Public)
router.post('/calculate-price', bookingController.calculatePrice);

// 6. Lấy danh sách bookings (yêu cầu đăng nhập)
router.get('/', authenticateUser, bookingController.getAllBookings);

// 7. Danh sách khách hàng phục vụ nhân viên đặt sân tại quầy (Staff & Admin)
router.get('/customers', authenticateUser, authorizeRole(['ADMIN', 'STAFF']), bookingController.getCustomers);

// 8. Lấy chi tiết đơn đặt sân theo ID (yêu cầu đăng nhập)
router.get('/:id', authenticateUser, bookingController.getBookingById);

// 9. Cập nhật trạng thái đơn đặt sân (yêu cầu đăng nhập)
router.patch('/:id/status', authenticateUser, bookingController.updateBookingStatus);

// 10. Thay đổi thông tin đặt sân (yêu cầu đăng nhập)
router.patch('/:id/change-info', authenticateUser, bookingController.changeBookingInfo);

// 11. Từ chối yêu cầu đặt sân (Staff & Admin)
router.patch('/:id/reject', authenticateUser, authorizeRole(['ADMIN', 'STAFF']), bookingController.rejectBooking);

// 12. Tạo mới đơn đặt sân (hỗ trợ cả khách đăng nhập lẫn khách vãng lai)
router.post('/', optionalAuth, bookingController.createBooking);

module.exports = router;
