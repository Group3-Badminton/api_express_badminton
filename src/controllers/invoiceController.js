const invoiceService = require('../services/invoiceService');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * Controller Quản lý Hóa đơn & Thanh toán (UC-12: Payment Management)
 * Tầng Controller chịu trách nhiệm nhận request, validation sơ bộ và trả về HTTP response
 * Logic nghiệp vụ được chuyển giao cho invoiceService.
 */

/**
 * UC-12.2: Lấy danh sách hóa đơn kèm phân trang, tìm kiếm, lọc và thống kê doanh thu
 */
exports.getInvoices = async (req, res) => {
  try {
    const result = await invoiceService.getInvoices(req.query);
    return sendSuccess(res, result, 'Lấy danh sách hóa đơn thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * UC-12.3: Xem chi tiết hóa đơn theo ID
 */
exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await invoiceService.getInvoiceById(id);
    return sendSuccess(res, invoice, 'Lấy chi tiết hóa đơn thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * UC-12.5: Kiểm tra và áp dụng thử Voucher cho hóa đơn
 */
exports.validateVoucherForInvoice = async (req, res) => {
  try {
    const result = await invoiceService.validateVoucherForInvoice(req.body);
    return sendSuccess(
      res,
      result,
      `Áp dụng mã giảm giá thành công! Giảm ${result.discountAmount.toLocaleString('vi-VN')} đ`,
      200
    );
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * UC-12.1: Thanh toán & quyết toán hóa đơn ca chơi tại quầy
 */
exports.settleSessionInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = req.user?.userId;
    const invoice = await invoiceService.settleSessionInvoice(id, req.body, staffId);
    return sendSuccess(res, invoice, 'Thanh toán hóa đơn ca chơi thành công! Sân đã sẵn sàng.', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * UC-12.4: Thanh toán bán hàng POS trực tiếp tại quầy
 */
exports.createPosPayment = async (req, res) => {
  try {
    const staffId = req.user?.userId;
    const invoice = await invoiceService.createPosPayment(req.body, staffId);
    return sendSuccess(res, invoice, 'Thanh toán đơn hàng POS thành công! Đã tự động trừ tồn kho.', 201);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};
