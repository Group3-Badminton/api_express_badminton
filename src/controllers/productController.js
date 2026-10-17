const productService = require('../services/productService');
const { sendSuccess, sendError } = require('../utils/response');

class ProductController {
  /**
   * UC-14.1 & UC-14.6: Xem danh sách sản phẩm & Tìm kiếm/lọc
   * Actor: Staff, Admin
   */
  async getProducts(req, res) {
    try {
      const result = await productService.getProducts(req.query);
      return sendSuccess(res, result, 'Lấy danh sách sản phẩm thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-14.2: Xem chi tiết sản phẩm
   * Actor: Staff, Admin
   */
  async getProductById(req, res) {
    try {
      const product = await productService.getProductById(req.params.id);
      return sendSuccess(res, product, 'Lấy thông tin chi tiết sản phẩm thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-14.3: Tạo mới sản phẩm
   * Actor: Admin
   */
  async createProduct(req, res) {
    try {
      const product = await productService.createProduct(req.body);
      return sendSuccess(res, product, 'Tạo sản phẩm mới thành công!', 201);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-14.4: Cập nhật thông tin sản phẩm
   * Actor: Admin
   */
  async updateProduct(req, res) {
    try {
      // Bảo vệ: Tuyệt đối không cho phép cập nhật tồn kho hay trạng thái qua endpoint sửa này
      const { name, price, description, category, unit } = req.body;
      const product = await productService.updateProduct(req.params.id, {
        name,
        price,
        description,
        category,
        unit
      });
      return sendSuccess(res, product, 'Cập nhật thông tin sản phẩm thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-14.5: Vô hiệu hóa sản phẩm
   * Actor: Admin
   */
  async deactivateProduct(req, res) {
    try {
      const product = await productService.deactivateProduct(req.params.id);
      return sendSuccess(res, product, 'Vô hiệu hóa sản phẩm thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * Kích hoạt lại sản phẩm
   * Actor: Admin
   */
  async activateProduct(req, res) {
    try {
      const product = await productService.activateProduct(req.params.id);
      return sendSuccess(res, product, 'Kích hoạt lại sản phẩm thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-14.7: Ghi nhận nhập kho sản phẩm
   * Actor: Admin
   */
  async stockIn(req, res) {
    try {
      const userId = req.user.userId;
      const result = await productService.stockIn(req.params.id, req.body, userId);
      return sendSuccess(res, result, 'Ghi nhận nhập kho thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }
}

module.exports = new ProductController();
