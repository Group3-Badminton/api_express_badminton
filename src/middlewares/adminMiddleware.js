const { sendError } = require('../utils/response');

module.exports = (req, res, next) => {
  if (!req.user) {
    return sendError(res, 'Vui lòng đăng nhập để thực hiện chức năng này!', 401);
  }

  if (req.user.role !== 'ADMIN') {
    return sendError(res, 'Bạn không có quyền thực hiện chức năng này (Yêu cầu quyền Quản trị viên)!', 403);
  }

  next();
};
