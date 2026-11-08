/**
 * Shared Court Booking Validation Helper (BR-08, BR-09)
 * Used to verify court booking eligibility when booking operations are integrated.
 */

const canBookCourt = (court, requestedStartTime, requestedEndTime) => {
  if (!court) {
    return { canBook: false, allowed: false, reason: 'Sân không tồn tại!' };
  }

  // BR-09: Sân đã vô hiệu hóa không nhận booking mới
  if (court.status !== 'ACTIVE') {
    return { canBook: false, allowed: false, reason: 'Sân đang ở trạng thái vô hiệu hóa, không thể nhận đặt sân mới (BR-09).' };
  }

  // BR-08: Chỉ sân ACTIVE và trong giờ hoạt động mới được đặt
  if (requestedStartTime && court.openingTime) {
    if (requestedStartTime < court.openingTime) {
      return { canBook: false, allowed: false, reason: `Thời gian bắt đầu (${requestedStartTime}) sớm hơn giờ mở cửa của sân (${court.openingTime}) (BR-08).` };
    }
  }

  if (requestedEndTime && court.closingTime) {
    if (requestedEndTime > court.closingTime) {
      return { canBook: false, allowed: false, reason: `Thời gian kết thúc (${requestedEndTime}) muộn hơn giờ đóng cửa của sân (${court.closingTime}) (BR-08).` };
    }
  }

  return { canBook: true, allowed: true };
};

module.exports = { canBookCourt };
