const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const authMiddleware = require('../middlewares/authMiddleware');
const staffOrAdminMiddleware = require('../middlewares/staffOrAdminMiddleware');

// Tất cả các route của Playing Session đều yêu cầu quyền Staff hoặc Admin
router.use(authMiddleware, staffOrAdminMiddleware);

router.get('/matrix', sessionController.getCourtMatrix);
router.get('/current', sessionController.getCurrentLiveBoard);
router.get('/', sessionController.getAllSessions);
router.get('/:id', sessionController.getSessionById);

// 4. UC-12.1: Check-in bắt đầu phiên chơi
router.post('/check-in', sessionController.checkInSession);

// 5. UC-12.2: Gia hạn thời gian chơi (+30m hoặc +60m)
router.post('/:id/extend', sessionController.extendSession);

// 6. Đổi sân cho phiên đang chơi
router.post('/:id/switch-court', sessionController.switchCourt);

// 7. UC-12.3: Check-out kết thúc phiên chơi & tính Overtime
router.post('/:id/check-out', sessionController.checkOutSession);

// 8. Hoàn tất dọn dẹp sân (chuyển sang AVAILABLE)
router.post('/courts/:courtId/clean-complete', sessionController.completeCleaning);

// 9. Thêm đồ thuê / dịch vụ vào phiên chơi
router.post('/:id/rentals', sessionController.addRentalItem);

module.exports = router;
