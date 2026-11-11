const formatErrorMessage = (message) => {
    if (!message) return 'Đã có lỗi xảy ra. Vui lòng thử lại!';
    const str = typeof message === 'string' ? message : (message.message || String(message));

    // MongoDB E11000 duplicate key error
    if (str.includes('E11000') || str.includes('duplicate key')) {
        if (str.includes('phone')) {
            return 'Số điện thoại này đã tồn tại trong hệ thống. Vui lòng kiểm tra lại!';
        }
        if (str.includes('email')) {
            return 'Email này đã tồn tại trong hệ thống. Vui lòng sử dụng email khác!';
        }
        if (str.includes('bookingCode')) {
            return 'Mã đơn đặt sân bị trùng lặp. Vui lòng thử lại!';
        }
        if (str.includes('courtName') || str.includes('name')) {
            return 'Tên này đã tồn tại trong hệ thống. Vui lòng chọn tên khác!';
        }
        if (str.includes('code')) {
            return 'Mã định danh đã tồn tại trong hệ thống!';
        }
        return 'Dữ liệu này đã tồn tại trong hệ thống (bị trùng lặp). Vui lòng thử lại!';
    }

    // Cast to ObjectId failed
    if (str.includes('Cast to ObjectId failed') || str.includes('24 hex characters')) {
        return 'Mã định danh dữ liệu không hợp lệ!';
    }

    // Validation failed
    if (str.includes('validation failed')) {
        return 'Dữ liệu gửi lên không đúng định dạng. Vui lòng kiểm tra lại!';
    }

    return str;
};

const sendSuccess = (res, data = null, message = 'Thành công', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        data,
        message
    });
};
const sendError = (res, message = 'Đã có lỗi xảy ra', statusCode = 500, errors = null) => {
    const formattedMessage = formatErrorMessage(message);
    const effectiveStatus = (statusCode === 500 && (String(message).includes('E11000') || String(message).includes('duplicate key'))) ? 409 : statusCode;
    return res.status(effectiveStatus).json({
        success: false,
        message: formattedMessage,
        errors
    });
};
module.exports = { sendSuccess, sendError, formatErrorMessage };