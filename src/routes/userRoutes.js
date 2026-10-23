const router = require('express').Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const staffOrAdminMiddleware = require('../middlewares/staffOrAdminMiddleware');

router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.get('/customers', authMiddleware, staffOrAdminMiddleware, userController.getCustomers);
router.patch('/customers/:id/unlock', authMiddleware, adminMiddleware, userController.unlockCustomer);

module.exports = router;