const router = require('express').Router();
const pricingController = require('../controllers/pricingController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// 1. API Public: Lấy danh mục loại sân và bảng giá cho HomePage
router.get('/overview', pricingController.getPricingOverview);

// 2. Các API quản lý quy tắc giá yêu cầu đăng nhập
router.use(authenticateUser);

// Xem quy tắc giá (STAFF & ADMIN)
router.get('/', authorizeRole(['ADMIN', 'STAFF']), pricingController.getAllPriceRules);
router.get('/:id', authorizeRole(['ADMIN', 'STAFF']), pricingController.getPriceRuleById);

// Thao tác CRUD Tạo, Sửa, Vô hiệu hóa, Kích hoạt bảng giá (CHỈ ADMIN)
router.post('/', authorizeRole('ADMIN'), pricingController.createPriceRule);
router.put('/:id', authorizeRole('ADMIN'), pricingController.updatePriceRule);
router.patch('/:id/deactivate', authorizeRole('ADMIN'), pricingController.deactivatePriceRule);
router.patch('/:id/activate', authorizeRole('ADMIN'), pricingController.activatePriceRule);

module.exports = router;
