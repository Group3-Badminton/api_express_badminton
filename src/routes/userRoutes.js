const router = require('express').Router();
const userController = require('../controllers/userController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Xem và sửa hồ sơ cá nhân (người dùng đã đăng nhập)
router.get('/profile', authenticateUser, userController.getProfile);
router.put('/profile', authenticateUser, userController.updateProfile);

// Danh sách khách hàng và mở khóa tài khoản
router.get('/customers', authenticateUser, authorizeRole(['ADMIN', 'STAFF']), userController.getCustomers);
router.patch('/customers/:id/unlock', authenticateUser, authorizeRole('ADMIN'), userController.unlockCustomer);

module.exports = router;
