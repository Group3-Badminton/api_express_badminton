const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Tất cả API sản phẩm yêu cầu đăng nhập
router.use(authenticateUser);

// UC-14.1 & UC-14.2 & UC-14.6: Xem danh sách & Chi tiết sản phẩm (Staff & Admin)
router.get('/', authorizeRole(['ADMIN', 'STAFF']), productController.getProducts);
router.get('/:id', authorizeRole(['ADMIN', 'STAFF']), productController.getProductById);

// UC-14.3, 14.4, 14.5, 14.7: Thao tác CRUD Tạo, Sửa, Vô hiệu hóa, Kích hoạt, Nhập kho (CHỈ ADMIN)
router.post('/', authorizeRole('ADMIN'), productController.createProduct);
router.patch('/:id', authorizeRole('ADMIN'), productController.updateProduct);
router.patch('/:id/deactivate', authorizeRole('ADMIN'), productController.deactivateProduct);
router.patch('/:id/activate', authorizeRole('ADMIN'), productController.activateProduct);
router.post('/:id/stock-ins', authorizeRole('ADMIN'), productController.stockIn);

module.exports = router;
