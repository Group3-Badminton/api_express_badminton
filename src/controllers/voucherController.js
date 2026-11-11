const voucherService = require('../services/voucherService');
const { sendSuccess, sendError } = require('../utils/response');

class VoucherController {
  async getVouchers(req, res) {
    try {
      const result = await voucherService.getVouchers(req.query);
      return sendSuccess(res, result, 'Lấy danh sách voucher thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  async getVoucherById(req, res) {
    try {
      const voucher = await voucherService.getVoucherById(req.params.id);
      return sendSuccess(res, voucher, 'Lấy thông tin chi tiết voucher thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  async createVoucher(req, res) {
    try {
      const adminUserId = req.user?._id || req.user?.id || req.user?.userId;
      const voucher = await voucherService.createVoucher(req.body, adminUserId);
      return sendSuccess(res, voucher, 'Tạo mã voucher thành công!', 201);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  async updateVoucher(req, res) {
    try {
      const voucher = await voucherService.updateVoucher(req.params.id, req.body);
      return sendSuccess(res, voucher, 'Cập nhật voucher thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  async deactivateVoucher(req, res) {
    try {
      const voucher = await voucherService.deactivateVoucher(req.params.id);
      return sendSuccess(res, voucher, 'Vô hiệu hóa voucher thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  async activateVoucher(req, res) {
    try {
      const voucher = await voucherService.activateVoucher(req.params.id);
      return sendSuccess(res, voucher, 'Kích hoạt lại voucher thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }
}

module.exports = new VoucherController();
