const router = require('express').Router();
const customerController = require('../controllers/customerController');
const authMiddleware = require('../middlewares/authMiddleware');
const staffOrAdminMiddleware = require('../middlewares/staffOrAdminMiddleware');

// Tất cả endpoint Quản lý khách hàng (UC-06) yêu cầu Nhân viên hoặc Admin đang ACTIVE
router.use(authMiddleware);
router.use(staffOrAdminMiddleware);

router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomerById);
router.post('/', customerController.createCustomer);
router.patch('/:id', customerController.updateCustomer);
router.patch('/:id/deactivate', customerController.deactivateCustomer);
router.patch('/:id/activate', customerController.activateCustomer);

module.exports = router;
