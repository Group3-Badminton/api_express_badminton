const sessionService = require('../services/sessionService');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * Controller quản lý phiên chơi
 * Tầng Controller chịu trách nhiệm nhận request, validation sơ bộ và trả về HTTP response
 * Logic nghiệp vụ được chuyển giao cho sessionService.
 */

/**
 * Lấy danh sách phiên chơi có lọc, phân trang, tìm kiếm
 */
exports.getAllSessions = async (req, res) => {
  try {
    const result = await sessionService.getAllSessions(req.query);
    return sendSuccess(res, result, 'Lấy danh sách ca chơi thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Lấy dữ liệu giám sát trực tiếp các sân (Live Board)
 */
exports.getCurrentLiveBoard = async (req, res) => {
  try {
    const courtBoard = await sessionService.getCurrentLiveBoard();
    return sendSuccess(res, courtBoard, 'Lấy dữ liệu giám sát sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Lấy chi tiết phiên chơi theo ID
 */
exports.getSessionById = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await sessionService.getSessionById(id);
    return sendSuccess(res, session, 'Lấy chi tiết ca chơi thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Check-in bắt đầu phiên chơi (khách đặt trước hoặc khách vãng lai)
 */
exports.checkInSession = async (req, res) => {
  try {
    const staffId = req.user?.userId;
    const session = await sessionService.checkInSession(req.body, staffId);
    return sendSuccess(res, session, 'Bắt đầu ca chơi thành công!', 201);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Gia hạn ca chơi (+30m hoặc +60m)
 */
exports.extendSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { extensionMinutes } = req.body;
    const session = await sessionService.extendSession(id, extensionMinutes);
    return sendSuccess(res, session, `Gia hạn ca chơi thành công thêm ${extensionMinutes} phút!`, 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Đổi sân cho ca đang chơi
 */
exports.switchCourt = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await sessionService.switchCourt(id, req.body);
    return sendSuccess(res, session, 'Chuyển ca chơi sang sân mới thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Check-out kết thúc ca chơi, giải phóng sân và xuất hóa đơn tại quầy
 */
exports.checkOutSession = async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = req.user?.userId;
    const result = await sessionService.checkOutSession(id, req.body, staffId);
    return sendSuccess(res, result, 'Kết thúc ca chơi thành công! Đã tạo hóa đơn thanh toán tại quầy.', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Thêm đồ thuê / dịch vụ vào phiên chơi
 */
exports.addRentalItem = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await sessionService.addRentalItem(id, req.body);
    return sendSuccess(res, session, 'Đã ghi nhận các mặt hàng vào ca chơi thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Lấy sơ đồ ma trận lịch sân theo ngày
 */
exports.getCourtMatrix = async (req, res) => {
  try {
    const result = await sessionService.getCourtMatrix(req.query);
    return sendSuccess(res, result, 'Lấy sơ đồ ma trận lịch sân thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};
