const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Tất cả endpoints quản trị voucher yêu cầu đăng nhập
router.use(authenticateUser);

// UC-15.1 & UC-15.2 & UC-15.6: Xem danh sách & Chi tiết voucher (Staff & Admin)
router.get('/', authorizeRole(['ADMIN', 'STAFF']), voucherController.getVouchers);
router.get('/:id', authorizeRole(['ADMIN', 'STAFF']), voucherController.getVoucherById);

// UC-15.3, 15.4, 15.5: Thao tác CRUD Tạo, Sửa, Vô hiệu hóa, Kích hoạt (CHỈ ADMIN)
router.post('/', authorizeRole('ADMIN'), voucherController.createVoucher);
router.patch('/:id', authorizeRole('ADMIN'), voucherController.updateVoucher);
router.patch('/:id/deactivate', authorizeRole('ADMIN'), voucherController.deactivateVoucher);
router.patch('/:id/activate', authorizeRole('ADMIN'), voucherController.activateVoucher);

module.exports = router;
