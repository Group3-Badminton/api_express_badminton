const { sendError } = require('../utils/response');

module.exports = (req, res, next) => {
  if (!req.user) {
    return sendError(res, 'Vui lòng đăng nhập để thực hiện chức năng này!', 401);
  }

  if (req.user.role !== 'ADMIN' && req.user.role !== 'STAFF') {
    return sendError(res, 'Bạn không có quyền thực hiện chức năng này (Yêu cầu quyền Quản trị viên hoặc Nhân viên)!', 403);
  }

  next();
};
