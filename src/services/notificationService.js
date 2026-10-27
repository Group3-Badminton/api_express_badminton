const mongoose = require('mongoose');
const Notification = require('../models/notification');

class NotificationService {
  /**
   * Helper build query cho phân trang & filter
   */
  _buildQueryOptions(params = {}) {
    const {
      search,
      isRead,
      type,
      status = 'ACTIVE',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = params;

    const filter = {};

    // Mặc định lọc theo ACTIVE (loại bỏ các thông báo đã deactivate)
    if (status && status !== 'ALL') {
      filter.status = status;
    }

    if (isRead !== undefined && isRead !== null && isRead !== '') {
      filter.isRead = isRead === 'true' || isRead === true;
    }

    if (type && type !== 'ALL') {
      filter.type = type;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [{ title: regex }, { message: regex }];
    }

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (currentPage - 1) * pageLimit;
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    return { filter, currentPage, pageLimit, skip, sort };
  }

  /**
   * UC-15.1: View Customer Notification List
   * Actor: Customer
   */
  async getCustomerNotifications(customerId, params = {}) {
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      const err = new Error('ID khách hàng không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const { filter, currentPage, pageLimit, skip, sort } = this._buildQueryOptions(params);

    // Chỉ lấy thông báo của chính Customer đó
    filter.recipientId = new mongoose.Types.ObjectId(customerId);
    filter.recipientType = 'CUSTOMER';

    const [items, total] = await Promise.all([
      Notification.find(filter).sort(sort).skip(skip).limit(pageLimit).lean(),
      Notification.countDocuments(filter)
    ]);

    return {
      items,
      pagination: {
        total,
        page: currentPage,
        limit: pageLimit,
        totalPages: Math.ceil(total / pageLimit) || 1
      }
    };
  }

  /**
   * UC-15.4: View Staff Notification List
   * Actor: Staff, Admin
   */
  async getStaffNotifications(user, params = {}) {
    const { filter, currentPage, pageLimit, skip, sort } = this._buildQueryOptions(params);

    const userId = user._id || user.id || user.userId;

    // Nhân viên / Admin xem thông báo gửi cho STAFF hoặc gửi riêng cho chính họ
    const recipientConditions = [{ recipientType: 'STAFF' }];
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      recipientConditions.push({ recipientId: new mongoose.Types.ObjectId(userId) });
    }

    if (filter.$or) {
      // Kết hợp điều kiện tìm kiếm và người nhận
      filter.$and = [
        { $or: filter.$or },
        { $or: recipientConditions }
      ];
      delete filter.$or;
    } else {
      filter.$or = recipientConditions;
    }

    const [items, total] = await Promise.all([
      Notification.find(filter).sort(sort).skip(skip).limit(pageLimit).lean(),
      Notification.countDocuments(filter)
    ]);

    return {
      items,
      pagination: {
        total,
        page: currentPage,
        limit: pageLimit,
        totalPages: Math.ceil(total / pageLimit) || 1
      }
    };
  }

  /**
   * UC-15.2 & UC-15.5: View Notification Detail (Customer / Staff / Admin)
   * Tự động đánh dấu đã đọc (isRead = true)
   */
  async getNotificationDetail(id, user) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('ID thông báo không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      const err = new Error('Không tìm thấy thông báo!');
      err.statusCode = 404;
      throw err;
    }

    const userId = (user._id || user.id || user.userId)?.toString();
    const userRole = user.role;

    // RBAC: Kiểm tra quyền truy cập chi tiết
    if (userRole === 'CUSTOMER') {
      if (notification.recipientId?.toString() !== userId) {
        const err = new Error('Bạn không có quyền xem thông báo này!');
        err.statusCode = 403;
        throw err;
      }
    } else if (userRole === 'STAFF' || userRole === 'ADMIN') {
      const isStaffNotif = notification.recipientType === 'STAFF';
      const isDirectNotif = notification.recipientId?.toString() === userId;
      if (!isStaffNotif && !isDirectNotif && userRole !== 'ADMIN') {
        const err = new Error('Bạn không có quyền xem thông báo này!');
        err.statusCode = 403;
        throw err;
      }
    } else {
      const err = new Error('Quyền hạn không hợp lệ!');
      err.statusCode = 403;
      throw err;
    }

    // Tự động đánh dấu đã đọc nếu chưa đọc
    if (!notification.isRead) {
      notification.isRead = true;
      await notification.save();
    }

    return notification.toObject();
  }

  /**
   * UC-15.3 & UC-15.6: Deactivate Notification (Customer / Staff / Admin)
   * Chuyển trạng thái sang 'INACTIVE'
   */
  async deactivateNotification(id, user) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('ID thông báo không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      const err = new Error('Không tìm thấy thông báo!');
      err.statusCode = 404;
      throw err;
    }

    const userId = (user._id || user.id || user.userId)?.toString();
    const userRole = user.role;

    // RBAC: Kiểm tra quyền vô hiệu hóa
    if (userRole === 'CUSTOMER') {
      if (notification.recipientId?.toString() !== userId) {
        const err = new Error('Bạn không có quyền vô hiệu hóa thông báo này!');
        err.statusCode = 403;
        throw err;
      }
    } else if (userRole === 'STAFF' || userRole === 'ADMIN') {
      const isStaffNotif = notification.recipientType === 'STAFF';
      const isDirectNotif = notification.recipientId?.toString() === userId;
      if (!isStaffNotif && !isDirectNotif && userRole !== 'ADMIN') {
        const err = new Error('Bạn không có quyền vô hiệu hóa thông báo này!');
        err.statusCode = 403;
        throw err;
      }
    } else {
      const err = new Error('Quyền hạn không hợp lệ!');
      err.statusCode = 403;
      throw err;
    }

    if (notification.status === 'INACTIVE') {
      const err = new Error('Thông báo này đã được vô hiệu hóa trước đó!');
      err.statusCode = 400;
      throw err;
    }

    notification.status = 'INACTIVE';
    await notification.save();

    return notification.toObject();
  }

  /**
   * Đánh dấu 1 thông báo là đã đọc
   */
  async markAsRead(id, user) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error('ID thông báo không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      const err = new Error('Không tìm thấy thông báo!');
      err.statusCode = 404;
      throw err;
    }

    const userId = (user._id || user.id || user.userId)?.toString();
    const userRole = user.role;

    if (userRole === 'CUSTOMER' && notification.recipientId?.toString() !== userId) {
      const err = new Error('Bạn không có quyền thao tác trên thông báo này!');
      err.statusCode = 403;
      throw err;
    }

    notification.isRead = true;
    await notification.save();

    return notification.toObject();
  }

  /**
   * Đánh dấu tất cả thông báo của người dùng là đã đọc
   */
  async markAllAsRead(user) {
    const userId = (user._id || user.id || user.userId);
    const userRole = user.role;

    let filter = { isRead: false, status: 'ACTIVE' };

    if (userRole === 'CUSTOMER') {
      filter.recipientId = new mongoose.Types.ObjectId(userId);
      filter.recipientType = 'CUSTOMER';
    } else {
      filter.$or = [
        { recipientType: 'STAFF' },
        { recipientId: new mongoose.Types.ObjectId(userId) }
      ];
    }

    const result = await Notification.updateMany(filter, { $set: { isRead: true } });
    return { modifiedCount: result.modifiedCount || result.nModified || 0 };
  }

  /**
   * Lấy số lượng thông báo chưa đọc (Unread Count)
   */
  async getUnreadCount(user) {
    const userId = (user._id || user.id || user.userId);
    const userRole = user.role;

    let filter = { isRead: false, status: 'ACTIVE' };

    if (userRole === 'CUSTOMER') {
      filter.recipientId = new mongoose.Types.ObjectId(userId);
      filter.recipientType = 'CUSTOMER';
    } else {
      filter.$or = [
        { recipientType: 'STAFF' },
        { recipientId: new mongoose.Types.ObjectId(userId) }
      ];
    }

    const unreadCount = await Notification.countDocuments(filter);
    return { unreadCount };
  }

  /**
   * Tạo thông báo mới (sử dụng nội bộ giữa các service)
   */
  async createNotification(payload) {
    const { recipientId, recipientType = 'CUSTOMER', type = 'BOOKING_NOTIFICATION', title, message } = payload;
    if (!title || !message) {
      const err = new Error('Tiêu đề và nội dung thông báo là bắt buộc!');
      err.statusCode = 400;
      throw err;
    }

    const notification = await Notification.create({
      recipientId,
      recipientType,
      type,
      title: title.trim(),
      message: message.trim(),
      isRead: false,
      status: 'ACTIVE'
    });

    return notification.toObject();
  }
}

module.exports = new NotificationService();
