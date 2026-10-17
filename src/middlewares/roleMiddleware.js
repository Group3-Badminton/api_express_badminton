const { sendError } = require('../utils/response');

/**
 * Middleware kiểm tra phân quyền Role dựa trên req.user (được giải mã từ JWT qua authMiddleware)
 * @param  {...string} allowedRoles - Danh sách role được phép truy cập (ví dụ 'ADMIN', 'STAFF')
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Vui lòng đăng nhập để thực hiện chức năng này!', 401);
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendError(res, 'Bạn không có quyền thực hiện chức năng này!', 403);
    }

    next();
  };
};

module.exports = { requireRole };
