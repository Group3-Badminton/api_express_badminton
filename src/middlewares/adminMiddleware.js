const { sendError } = require('../utils/response');

module.exports = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN' || req.user.status !== 'ACTIVE') {
    return sendError(res, 'Bạn không có quyền thực hiện thao tác này! Yêu cầu quyền Quản trị viên.', 403);
  }
  next();
};
