const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

// Tất cả các route của Playing Session đều yêu cầu quyền Staff hoặc Admin
router.use(authenticateUser, authorizeRole(['ADMIN', 'STAFF']));

router.get('/matrix', sessionController.getCourtMatrix);
router.get('/current', sessionController.getCurrentLiveBoard);
router.get('/', sessionController.getAllSessions);
router.get('/:id', sessionController.getSessionById);

// Check-in bắt đầu phiên chơi
router.post('/check-in', sessionController.checkInSession);

// Gia hạn thời gian chơi
router.post('/:id/extend', sessionController.extendSession);

// Đổi sân cho phiên đang chơi
router.post('/:id/switch-court', sessionController.switchCourt);

// Check-out kết thúc phiên chơi và tính Overtime
router.post('/:id/check-out', sessionController.checkOutSession);

// Thêm đồ thuê / dịch vụ vào phiên chơi
router.post('/:id/rentals', sessionController.addRentalItem);

module.exports = router;
