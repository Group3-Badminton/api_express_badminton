const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Tất cả endpoints quản lý thông báo yêu cầu người dùng phải đăng nhập
router.use(authenticateUser);

// Lấy số lượng thông báo chưa đọc
router.get('/unread-count', notificationController.getUnreadCount);

// Đánh dấu tất cả thông báo là đã đọc
router.patch('/mark-all-read', notificationController.markAllAsRead);

// UC-15.1: Xem danh sách thông báo dành riêng cho Khách hàng
router.get('/customer', authorizeRole('CUSTOMER'), notificationController.getCustomerNotifications);

// UC-15.4: Xem danh sách thông báo dành riêng cho Nhân viên & Quản trị viên
router.get('/staff', authorizeRole(['STAFF', 'ADMIN']), notificationController.getStaffNotifications);

// Xem danh sách thông báo chung (tự nhận diện theo role)
router.get('/', notificationController.getMyNotifications);

// UC-15.2 & UC-15.5: Xem chi tiết thông báo (tự động chuyển isRead = true)
router.get('/:id', notificationController.getNotificationDetail);

// UC-15.3 & UC-15.6: Vô hiệu hóa thông báo (chuyển status sang INACTIVE)
router.patch('/:id/deactivate', notificationController.deactivateNotification);

// Đánh dấu 1 thông báo là đã đọc
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
