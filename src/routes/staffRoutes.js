const router = require('express').Router();
const staffController = require('../controllers/staffController');
const { authenticateUser, checkAdmin } = require('../middlewares/authMiddleware');

// Tất cả endpoint quản lý nhân viên yêu cầu Admin đăng nhập
router.use(authenticateUser, checkAdmin);

router.get('/', staffController.getStaffs);
router.get('/:id', staffController.getStaffById);
router.post('/', staffController.createStaff);
router.patch('/:id', staffController.updateStaff);
router.patch('/:id/deactivate', staffController.deactivateStaff);
router.patch('/:id/activate', staffController.activateStaff);

module.exports = router;
