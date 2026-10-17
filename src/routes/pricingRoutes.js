const router = require('express').Router();
const pricingController = require('../controllers/pricingController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

// Tất cả các thao tác quản lý quy tắc giá trong UC-18 yêu cầu đăng nhập và có quyền Admin
router.use(authMiddleware);
router.use(adminMiddleware);

// UC-18.1: Lấy danh sách quy tắc giá
router.get('/', pricingController.getAllPriceRules);

// Lấy chi tiết quy tắc giá
router.get('/:id', pricingController.getPriceRuleById);

// UC-18.2: Tạo quy tắc giá mới
router.post('/', pricingController.createPriceRule);

// UC-18.3: Cập nhật quy tắc giá
router.put('/:id', pricingController.updatePriceRule);

// UC-18.4: Vô hiệu hóa quy tắc giá (Soft deactivate, giữ lịch sử)
router.patch('/:id/deactivate', pricingController.deactivatePriceRule);

// Kích hoạt lại quy tắc giá (nếu cần khôi phục)
router.patch('/:id/activate', pricingController.activatePriceRule);

module.exports = router;
