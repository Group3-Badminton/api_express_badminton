const router = require('express').Router();
const courtController = require('../controllers/courtController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const staffOrAdminMiddleware = require('../middlewares/staffOrAdminMiddleware');

// Tất cả thao tác yêu cầu đăng nhập và tài khoản ACTIVE
router.use(authMiddleware);

// UC-9.1: Danh sách (STAFF & ADMIN) / UC-9.6: Tìm kiếm & lọc (ADMIN only - kiểm tra trong controller)
router.get('/', staffOrAdminMiddleware, courtController.getCourts);

// UC-9.2: Chi tiết sân (STAFF & ADMIN)
router.get('/:id', staffOrAdminMiddleware, courtController.getCourtById);

// UC-9.3: Tạo sân (ADMIN only)
router.post('/', adminMiddleware, courtController.createCourt);

// UC-9.4: Cập nhật thông tin sân (ADMIN only)
router.patch('/:id', adminMiddleware, courtController.updateCourt);

// UC-9.5: Vô hiệu hóa sân (ADMIN only)
router.patch('/:id/deactivate', adminMiddleware, courtController.deactivateCourt);

module.exports = router;
