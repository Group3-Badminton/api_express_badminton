const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');

// Tất cả API sản phẩm yêu cầu đăng nhập
router.use(authMiddleware);

// UC-14.1 & UC-14.6: Xem danh sách & Tìm kiếm, lọc (Staff & Admin)
router.get('/', requireRole('ADMIN', 'STAFF'), productController.getProducts);

// UC-14.2: Xem chi tiết sản phẩm (Staff & Admin)
router.get('/:id', requireRole('ADMIN', 'STAFF'), productController.getProductById);

// UC-14.3: Tạo sản phẩm mới (Admin only)
router.post('/', requireRole('ADMIN'), productController.createProduct);

// UC-14.4: Cập nhật thông tin sản phẩm (Admin only)
router.patch('/:id', requireRole('ADMIN'), productController.updateProduct);

// UC-14.5: Vô hiệu hóa sản phẩm (Admin only)
router.patch('/:id/deactivate', requireRole('ADMIN'), productController.deactivateProduct);

// Kích hoạt lại sản phẩm (Admin only)
router.patch('/:id/activate', requireRole('ADMIN'), productController.activateProduct);

// UC-14.7: Nhập kho sản phẩm (Admin only)
router.post('/:id/stock-ins', requireRole('ADMIN'), productController.stockIn);

module.exports = router;
