const router = require('express').Router();
const staffController = require('../controllers/staffController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

// Tất cả endpoint quản lý nhân viên yêu cầu Admin đăng nhập và đang ACTIVE
router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/', staffController.getStaffs);
router.get('/:id', staffController.getStaffById);
router.post('/', staffController.createStaff);
router.patch('/:id', staffController.updateStaff);
router.patch('/:id/deactivate', staffController.deactivateStaff);
router.patch('/:id/activate', staffController.activateStaff);

module.exports = router;
