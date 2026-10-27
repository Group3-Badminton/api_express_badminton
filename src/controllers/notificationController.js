const notificationService = require('../services/notificationService');
const { sendSuccess, sendError } = require('../utils/response');

class NotificationController {
  /**
   * Lấy danh sách thông báo của tài khoản hiện tại (tự động theo role Customer / Staff / Admin)
   */
  async getMyNotifications(req, res) {
    try {
      const user = req.user;
      let result;
      if (user.role === 'CUSTOMER') {
        result = await notificationService.getCustomerNotifications(user._id, req.query);
      } else {
        result = await notificationService.getStaffNotifications(user, req.query);
      }
      return sendSuccess(res, result, 'Lấy danh sách thông báo thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-15.1: View Customer Notification List
   * Actor: Customer
   */
  async getCustomerNotifications(req, res) {
    try {
      const customerId = req.user._id;
      const result = await notificationService.getCustomerNotifications(customerId, req.query);
      return sendSuccess(res, result, 'Lấy danh sách thông báo khách hàng thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-15.4: View Staff Notification List
   * Actor: Staff, Admin
   */
  async getStaffNotifications(req, res) {
    try {
      const result = await notificationService.getStaffNotifications(req.user, req.query);
      return sendSuccess(res, result, 'Lấy danh sách thông báo nhân viên thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-15.2 & UC-15.5: View Notification Detail
   * Tự động đánh dấu đã đọc
   */
  async getNotificationDetail(req, res) {
    try {
      const result = await notificationService.getNotificationDetail(req.params.id, req.user);
      return sendSuccess(res, result, 'Lấy chi tiết thông báo thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * UC-15.3 & UC-15.6: Deactivate Notification
   * Chuyển trạng thái sang INACTIVE (ẩn khỏi danh sách)
   */
  async deactivateNotification(req, res) {
    try {
      const result = await notificationService.deactivateNotification(req.params.id, req.user);
      return sendSuccess(res, result, 'Vô hiệu hóa thông báo thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * Đánh dấu 1 thông báo là đã đọc
   */
  async markAsRead(req, res) {
    try {
      const result = await notificationService.markAsRead(req.params.id, req.user);
      return sendSuccess(res, result, 'Đánh dấu thông báo đã đọc thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * Đánh dấu tất cả thông báo là đã đọc
   */
  async markAllAsRead(req, res) {
    try {
      const result = await notificationService.markAllAsRead(req.user);
      return sendSuccess(res, result, 'Đã đánh dấu tất cả thông báo là đã đọc!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  /**
   * Lấy số lượng thông báo chưa đọc
   */
  async getUnreadCount(req, res) {
    try {
      const result = await notificationService.getUnreadCount(req.user);
      return sendSuccess(res, result, 'Lấy số lượng thông báo chưa đọc thành công!');
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }
}

module.exports = new NotificationController();
