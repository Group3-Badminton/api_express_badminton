const Invoice = require('../models/invoice');
const Product = require('../models/product');
const Voucher = require('../models/voucher');
const PlayingSession = require('../models/playingSession');
const Court = require('../models/court');
const { sendSuccess, sendError } = require('../utils/response');

function calculateVoucherDiscount(voucher, orderAmount, eligibleAmount = null) {
  const now = new Date();
  if (!voucher || voucher.status !== 'ACTIVE') {
    throw new Error('Mã giảm giá không tồn tại hoặc đang bị tạm khóa!');
  }

  const start = new Date(voucher.startDate);
  const end = new Date(voucher.endDate);
  if (now < start || now > end) {
    throw new Error('Mã giảm giá đã hết hạn hoặc chưa đến thời gian áp dụng!');
  }

  if (voucher.usageLimit != null && voucher.usedCount >= voucher.usageLimit) {
    throw new Error('Mã giảm giá đã hết lượt sử dụng!');
  }

  const baseAmount = eligibleAmount !== null ? eligibleAmount : orderAmount;
  const minSpend = Number(voucher.minInvoiceAmount) || 0;
  if (baseAmount < minSpend) {
    throw new Error(`Đơn hàng chưa đạt giá trị tối thiểu (${minSpend.toLocaleString('vi-VN')} đ) để áp dụng mã giảm giá này!`);
  }

  let discount = 0;
  if (voucher.discountType === 'PERCENTAGE') {
    discount = Math.round((baseAmount * voucher.discountValue) / 100);
    if (voucher.maxDiscountAmount && discount > voucher.maxDiscountAmount) {
      discount = voucher.maxDiscountAmount;
    }
  } else {
    discount = Math.min(baseAmount, voucher.discountValue);
  }

  return Math.max(0, Math.min(discount, orderAmount));
}

exports.getInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      orderType = '',
      paymentMethod = '',
      paymentStatus = '',
      startDate = '',
      endDate = ''
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    await Invoice.updateMany(
      { $or: [{ orderType: { $exists: false } }, { orderType: null }] },
      { $set: { orderType: 'PLAYING_SESSION' } }
    );

    const conditions = [];

    if (orderType && orderType !== 'ALL') {
      if (orderType === 'PLAYING_SESSION') {
        conditions.push({
          $or: [
            { orderType: 'PLAYING_SESSION' },
            { orderType: { $exists: false } },
            { orderType: null },
            { playingSessionId: { $ne: null } }
          ]
        });
      } else if (orderType === 'POS') {
        conditions.push({ orderType: 'POS' });
      }
    }

    if (paymentMethod && paymentMethod !== 'ALL') {
      conditions.push({ paymentMethod });
    }

    if (paymentStatus && paymentStatus !== 'ALL') {
      conditions.push({ paymentStatus });
    }

    if (startDate || endDate) {
      const dateCond = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateCond.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateCond.$lte = e;
      }
      conditions.push({ createdAt: dateCond });
    }

    if (search && search.trim()) {
      const cleanSearch = search.trim();
      conditions.push({
        $or: [
          { invoiceCode: { $regex: cleanSearch, $options: 'i' } },
          { 'customer.fullName': { $regex: cleanSearch, $options: 'i' } },
          { 'customer.phone': { $regex: cleanSearch, $options: 'i' } },
          { transactionReference: { $regex: cleanSearch, $options: 'i' } }
        ]
      });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const totalInvoices = await Invoice.countDocuments(filter);
    const invoices = await Invoice.find(filter)
      .populate('staffId', 'fullName email phone')
      .populate('playingSessionId', 'sessionCode scheduledStartTime scheduledEndTime')
      .populate('items.productId', 'name price unit category')
      .populate('voucherId', 'code name discountType discountValue')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const statsAgg = await Invoice.aggregate([
      { $match: { ...filter, paymentStatus: 'PAID' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalPaidCount: { $sum: 1 },
          totalCash: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'CASH'] }, '$totalAmount', 0]
            }
          },
          totalTransfer: {
            $sum: {
              $cond: [{ $in: ['$paymentMethod', ['TRANSFER', 'VIETQR', 'ONLINE']] }, '$totalAmount', 0]
            }
          }
        }
      }
    ]);

    const stats = statsAgg[0] || {
      totalRevenue: 0,
      totalPaidCount: 0,
      totalCash: 0,
      totalTransfer: 0
    };

    return sendSuccess(res, {
      invoices,
      pagination: {
        total: totalInvoices,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalInvoices / limitNum)
      },
      stats
    }, 'Lấy danh sách hóa đơn thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id)
      .populate('staffId', 'fullName email phone')
      .populate({
        path: 'playingSessionId',
        populate: [
          { path: 'courtId', select: 'name type price' },
          { path: 'bookingId', select: 'bookingCode startTime endTime' }
        ]
      })
      .populate('items.productId', 'name price unit category')
      .populate('voucherId', 'code name discountType discountValue')
      .lean();

    if (!invoice) {
      return sendError(res, 'Không tìm thấy hóa đơn!', 404);
    }

    return sendSuccess(res, invoice, 'Lấy chi tiết hóa đơn thành công!', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.validateVoucherForInvoice = async (req, res) => {
  try {
    const { code, orderAmount = 0 } = req.body;
    if (!code || !code.trim()) {
      return sendError(res, 'Vui lòng nhập mã giảm giá!', 400);
    }

    const cleanCode = code.trim().toUpperCase();
    const voucher = await Voucher.findOne({ code: cleanCode });
    if (!voucher) {
      return sendError(res, 'Mã giảm giá không tồn tại. Vui lòng kiểm tra lại!', 404);
    }

    let discountAmount = 0;
    try {
      discountAmount = calculateVoucherDiscount(voucher, Number(orderAmount) || 0);
    } catch (ve) {
      return sendError(res, ve.message, 400);
    }

    const finalAmount = Math.max(0, (Number(orderAmount) || 0) - discountAmount);

    return sendSuccess(res, {
      voucher: {
        _id: voucher._id,
        code: voucher.code,
        name: voucher.name,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        maxDiscountAmount: voucher.maxDiscountAmount,
        minInvoiceAmount: voucher.minInvoiceAmount
      },
      discountAmount,
      finalAmount
    }, `Áp dụng mã giảm giá thành công! Giảm ${discountAmount.toLocaleString('vi-VN')} đ`, 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.settleSessionInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      paymentMethod = 'CASH',
      cashReceived = 0,
      transactionReference = '',
      voucherCode = '',
      note = ''
    } = req.body;

    const invoice = await Invoice.findById(id).populate('playingSessionId');
    if (!invoice) {
      return sendError(res, 'Không tìm thấy hóa đơn cần thanh toán!', 404);
    }

    if (invoice.paymentStatus === 'PAID') {
      return sendError(res, 'Hóa đơn này đã được thanh toán và khóa trước đó!', 400);
    }

    const subtotal = Number(invoice.subtotal) || 0;
    let discountAmount = 0;
    let appliedVoucher = null;

    if (voucherCode && voucherCode.trim()) {
      const cleanCode = voucherCode.trim().toUpperCase();
      appliedVoucher = await Voucher.findOne({ code: cleanCode });
      if (!appliedVoucher) {
        return sendError(res, 'Mã giảm giá không tồn tại!', 400);
      }
      try {
        discountAmount = calculateVoucherDiscount(appliedVoucher, subtotal);
      } catch (ve) {
        return sendError(res, ve.message, 400);
      }
    }

    const totalAmount = Math.max(0, subtotal - discountAmount);
    let changeAmount = 0;

    if (paymentMethod === 'CASH') {
      const received = Number(cashReceived);
      if (isNaN(received) || received < totalAmount) {
        return sendError(
          res,
          `Số tiền khách đưa (${(received || 0).toLocaleString('vi-VN')} đ) nhỏ hơn số tiền cần thanh toán (${totalAmount.toLocaleString('vi-VN')} đ)!`,
          400
        );
      }
      changeAmount = received - totalAmount;
    }

    invoice.subtotal = subtotal;
    invoice.discountAmount = discountAmount;
    invoice.totalAmount = totalAmount;
    invoice.paymentMethod = paymentMethod;
    invoice.cashReceived = paymentMethod === 'CASH' ? Number(cashReceived) : totalAmount;
    invoice.changeAmount = changeAmount;
    invoice.transactionReference = transactionReference || '';
    invoice.paymentStatus = 'PAID';
    invoice.paidAt = new Date();
    invoice.staffId = req.user?.userId || invoice.staffId;
    if (note) invoice.note = note;

    if (appliedVoucher) {
      invoice.voucherId = appliedVoucher._id;
      invoice.voucherCode = appliedVoucher.code;
      await Voucher.findByIdAndUpdate(appliedVoucher._id, { $inc: { usedCount: 1 } });
    }

    await invoice.save();

    if (invoice.playingSessionId) {
      const session = await PlayingSession.findById(invoice.playingSessionId);
      if (session && session.courtId) {
        await Court.findByIdAndUpdate(session.courtId, { operationalStatus: 'AVAILABLE' });
      }
    }

    return sendSuccess(res, invoice, 'Thanh toán hóa đơn ca chơi thành công! Sân đã sẵn sàng.', 200);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

exports.createPosPayment = async (req, res) => {
  try {
    const {
      items = [],
      customerName = 'Khách lẻ',
      customerPhone = '',
      paymentMethod = 'CASH',
      cashReceived = 0,
      transactionReference = '',
      voucherCode = '',
      note = ''
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, 'Vui lòng chọn ít nhất một sản phẩm để thanh toán!', 400);
    }

    const processedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        return sendError(res, 'Số lượng sản phẩm phải lớn hơn 0!', 400);
      }

      const product = await Product.findById(item.productId);
      if (!product || product.status !== 'ACTIVE') {
        return sendError(res, `Sản phẩm "${item.productName || item.productId}" không tồn tại hoặc đã ngừng kinh doanh!`, 400);
      }

      if (product.stockQuantity < qty) {
        return sendError(
          res,
          `Sản phẩm "${product.name}" không đủ số lượng trong kho! (Còn tồn: ${product.stockQuantity}, yêu cầu: ${qty})`,
          400
        );
      }

      const itemSubtotal = product.price * qty;
      subtotal += itemSubtotal;

      processedItems.push({
        productId: product._id,
        productName: product.name,
        quantity: qty,
        unitPrice: product.price,
        subtotal: itemSubtotal
      });
    }

    let discountAmount = 0;
    let appliedVoucher = null;

    if (voucherCode && voucherCode.trim()) {
      const cleanCode = voucherCode.trim().toUpperCase();
      appliedVoucher = await Voucher.findOne({ code: cleanCode });
      if (!appliedVoucher) {
        return sendError(res, 'Mã giảm giá không tồn tại!', 400);
      }
      try {
        discountAmount = calculateVoucherDiscount(appliedVoucher, subtotal);
      } catch (ve) {
        return sendError(res, ve.message, 400);
      }
    }

    const totalAmount = Math.max(0, subtotal - discountAmount);
    let changeAmount = 0;

    if (paymentMethod === 'CASH') {
      const received = Number(cashReceived);
      if (isNaN(received) || received < totalAmount) {
        return sendError(
          res,
          `Số tiền khách đưa (${(received || 0).toLocaleString('vi-VN')} đ) nhỏ hơn tổng tiền đơn hàng (${totalAmount.toLocaleString('vi-VN')} đ)!`,
          400
        );
      }
      changeAmount = received - totalAmount;
    }

    for (const item of processedItems) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQuantity: -item.quantity }
      });
    }

    if (appliedVoucher) {
      await Voucher.findByIdAndUpdate(appliedVoucher._id, { $inc: { usedCount: 1 } });
    }

    const invoiceCode = 'POS-' + Date.now().toString().slice(-6);
    const invoice = await Invoice.create({
      invoiceCode,
      orderType: 'POS',
      staffId: req.user?.userId || null,
      items: processedItems,
      customer: {
        fullName: customerName || 'Khách lẻ',
        phone: customerPhone || ''
      },
      subtotal,
      discountAmount,
      totalAmount,
      voucherId: appliedVoucher ? appliedVoucher._id : null,
      voucherCode: appliedVoucher ? appliedVoucher.code : '',
      paymentMethod,
      cashReceived: paymentMethod === 'CASH' ? Number(cashReceived) : totalAmount,
      changeAmount,
      transactionReference: transactionReference || '',
      paymentStatus: 'PAID',
      paidAt: new Date(),
      note: note || '',
      status: 'ACTIVE'
    });

    return sendSuccess(res, invoice, 'Thanh toán đơn hàng POS thành công! Đã tự động trừ tồn kho.', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};
