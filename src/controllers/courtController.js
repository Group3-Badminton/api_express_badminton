const Court = require('../models/court');
const { sendSuccess, sendError } = require('../utils/response');
require('../models/priceTable');
//lấy danh sách sân và bảng giá cho homepage
exports.getPublicCourts = async (req, res) => {
    try {
        const courts = await Court.find({ isActive: true })
            .populate('priceTableId')
            .sort({ name: 1 });

        return sendSuccess(res, courts, 'Lấy danh sách sân công khai thành công', 200);
    } catch (error) {
        return sendError(res, error.message, 500);
    }
};
