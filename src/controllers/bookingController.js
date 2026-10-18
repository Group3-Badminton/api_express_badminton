const bookingService = require('../services/bookingService');
const { sendSuccess, sendError } = require('../utils/response');

class BookingController {
  constructor() {
    this.getAllBookings = this.getAllBookings.bind(this);
    this.getBookingById = this.getBookingById.bind(this);
    this.getCourts = this.getCourts.bind(this);
    this.getTimeSlots = this.getTimeSlots.bind(this);
    this.getCourtAvailability = this.getCourtAvailability.bind(this);
    this.validateVoucher = this.validateVoucher.bind(this);
    this.createBooking = this.createBooking.bind(this);
    this.updateBookingStatus = this.updateBookingStatus.bind(this);
    this.changeBookingInfo = this.changeBookingInfo.bind(this);
    this.rejectBooking = this.rejectBooking.bind(this);
    this.getCustomers = this.getCustomers.bind(this);
  }

  // 1. Lấy danh sách booking (tìm kiếm, lọc theo ngày/trạng thái/sân/phân trang, thống kê)
  async getAllBookings(req, res) {
    try {
      const result = await bookingService.getAllBookings(req.query, req.user);
      return sendSuccess(res, result, 'Lấy danh sách đặt sân thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 2. Lấy chi tiết đơn đặt sân theo ID
  async getBookingById(req, res) {
    try {
      const result = await bookingService.getBookingById(req.params.id, req.user);
      return sendSuccess(res, result, 'Lấy chi tiết đơn đặt sân thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 3. Lấy danh sách sân thi đấu
  async getCourts(req, res) {
    try {
      const result = await bookingService.getCourts();
      return sendSuccess(res, result, 'Lấy danh sách sân thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 4. Lấy danh sách khung giờ thi đấu
  async getTimeSlots(req, res) {
    try {
      const result = await bookingService.getTimeSlots();
      return sendSuccess(res, result, 'Lấy danh sách khung giờ thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 5. Kiểm tra tình trạng khung giờ còn trống & Bảng giá theo Sân và Ngày
  async getCourtAvailability(req, res) {
    try {
      const { courtId, bookingDate } = req.query;
      const result = await bookingService.getCourtAvailability(courtId, bookingDate);
      return sendSuccess(res, result, 'Lấy thông tin tình trạng khung giờ sân thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 6. Kiểm tra và áp dụng mã giảm giá (Voucher)
  async validateVoucher(req, res) {
    try {
      const { voucherCode, orderAmount } = req.body;
      const result = await bookingService.validateVoucher(voucherCode, orderAmount);
      return sendSuccess(res, result, 'Áp dụng mã giảm giá thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 7. Tạo mới đơn đặt sân (Hỗ trợ cả khách đăng nhập lẫn khách vãng lai không cần email)
  async createBooking(req, res) {
    try {
      const result = await bookingService.createBooking(req.body, req.user);
      return sendSuccess(res, result, 'Đặt sân cầu lông thành công!', 201);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 8. Cập nhật trạng thái đơn đặt sân
  async updateBookingStatus(req, res) {
    try {
      const result = await bookingService.updateBookingStatus(req.params.id, req.body);
      return sendSuccess(res, result, 'Cập nhật trạng thái đặt sân thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 9. AF1: Thay đổi thông tin đặt sân (Change Booking Information)
  async changeBookingInfo(req, res) {
    try {
      const { booking, notificationSent } = await bookingService.changeBookingInfo(req.params.id, req.body);
      const msg = notificationSent
        ? 'Thay đổi thông tin và xác nhận đặt sân thành công!'
        : 'Yêu cầu đặt sân đã được xử lý và xác nhận thành công, nhưng không thể gửi thông báo.';
      return sendSuccess(res, booking, msg, 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 10. AF2: Từ chối yêu cầu đặt sân (Reject Booking)
  async rejectBooking(req, res) {
    try {
      const { booking, notificationSent } = await bookingService.rejectBooking(req.params.id, req.body?.reason);
      const msg = notificationSent
        ? 'Từ chối yêu cầu đặt sân thành công!'
        : 'Yêu cầu đặt sân đã được xử lý thành công, nhưng không thể gửi thông báo.';
      return sendSuccess(res, booking, msg, 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }

  // 11. Lấy danh sách khách hàng phục vụ staff / admin đặt sân
  async getCustomers(req, res) {
    try {
      const result = await bookingService.getCustomers();
      return sendSuccess(res, result, 'Lấy danh sách khách hàng thành công!', 200);
    } catch (error) {
      return sendError(res, error.message, error.statusCode || 500);
    }
  }
}

module.exports = new BookingController();
