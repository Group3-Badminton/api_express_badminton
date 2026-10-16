const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

// Tất cả endpoints quản trị voucher yêu cầu đăng nhập
router.use(authMiddleware);

// UC-15.1 & UC-15.6: Xem danh sách & Tìm kiếm, lọc (Staff & Admin)
router.get('/', requireRole('ADMIN', 'STAFF'), voucherController.getVouchers);

// UC-15.2: Xem chi tiết voucher (Staff & Admin)
router.get('/:id', requireRole('ADMIN', 'STAFF'), voucherController.getVoucherById);

// UC-15.3: Tạo voucher mới (Admin only)
router.post('/', requireRole('ADMIN'), voucherController.createVoucher);

// UC-15.4: Cập nhật voucher (Admin only)
router.patch('/:id', requireRole('ADMIN'), voucherController.updateVoucher);

// UC-15.5: Vô hiệu hóa voucher (Admin only)
router.patch('/:id/deactivate', requireRole('ADMIN'), voucherController.deactivateVoucher);

// Kích hoạt lại voucher (Admin only)
router.patch('/:id/activate', requireRole('ADMIN'), voucherController.activateVoucher);

module.exports = router;
