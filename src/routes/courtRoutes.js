const router = require('express').Router();
const courtController = require('../controllers/courtController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Tất cả thao tác trong trang Quản lý sân yêu cầu đăng nhập
router.use(authenticateUser);

// UC-9.1 & UC-9.2: Xem danh sách và chi tiết sân (STAFF & ADMIN)
router.get('/', authorizeRole(['ADMIN', 'STAFF']), courtController.getCourts);
router.get('/:id', authorizeRole(['ADMIN', 'STAFF']), courtController.getCourtById);

// UC-9.3, UC-9.4, UC-9.5: Thao tác CRUD Tạo, Sửa, Vô hiệu hóa, Xóa sân (CHỈ ADMIN)
router.post('/', authorizeRole('ADMIN'), courtController.createCourt);
router.patch('/:id', authorizeRole('ADMIN'), courtController.updateCourt);
router.patch('/:id/deactivate', authorizeRole('ADMIN'), courtController.deactivateCourt);
router.delete('/:id', authorizeRole('ADMIN'), courtController.deleteCourt);

module.exports = router;
