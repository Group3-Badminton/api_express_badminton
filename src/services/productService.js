const mongoose = require('mongoose');
const Product = require('../models/product');
const StockInHistory = require('../models/stockInHistory');

class ProductService {
  /**
   * UC-14.1 & UC-14.6: Lấy danh sách sản phẩm có tìm kiếm, lọc và phân trang tại server
   */
  async getProducts(params = {}) {
    const {
      search,
      status,
      stockStatus,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = params;

    const query = {};

    // Tìm kiếm theo tên (trim & regex an toàn)
    if (search && search.trim()) {
      const cleanSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = { $regex: cleanSearch, $options: 'i' };
    }

    // Lọc theo trạng thái (ACTIVE / INACTIVE)
    if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
      query.status = status;
    }

    // Lọc theo tình trạng tồn kho
    if (stockStatus === 'IN_STOCK') {
      query.stockQuantity = { $gt: 0 };
    } else if (stockStatus === 'OUT_OF_STOCK') {
      query.stockQuantity = 0;
    }

    // Lọc theo khoảng giá
    const parsedMinPrice = minPrice !== undefined && minPrice !== '' ? Number(minPrice) : null;
    const parsedMaxPrice = maxPrice !== undefined && maxPrice !== '' ? Number(maxPrice) : null;

    if (parsedMinPrice !== null && !isNaN(parsedMinPrice) && parsedMinPrice >= 0) {
      query.price = { ...query.price, $gte: parsedMinPrice };
    }
    if (parsedMaxPrice !== null && !isNaN(parsedMaxPrice) && parsedMaxPrice >= 0) {
      query.price = { ...query.price, $lte: parsedMaxPrice };
    }

    // Kiểm tra sort field hợp lệ để đảm bảo an toàn & ổn định
    const allowedSortFields = ['name', 'price', 'stockQuantity', 'status', 'createdAt', 'updatedAt'];
    const finalSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const finalSortOrder = sortOrder === 'asc' ? 1 : -1;
    const sort = { [finalSortBy]: finalSortOrder, _id: -1 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(limitNum).lean(),
      Product.countDocuments(query)
    ]);

    return {
      items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    };
  }

  /**
   * UC-14.2: Xem chi tiết sản phẩm và lịch sử nhập kho liên quan
   */
  async getProductById(productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      const err = new Error('Mã sản phẩm không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      const err = new Error('Không tìm thấy sản phẩm!');
      err.statusCode = 404;
      throw err;
    }

    // Lấy kèm lịch sử nhập kho gần nhất
    const stockHistory = await StockInHistory.find({ productId })
      .populate('performedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return {
      ...product,
      stockHistory
    };
  }

  /**
   * UC-14.3: Tạo sản phẩm mới (chỉ Admin)
   */
  async createProduct(data) {
    const { name, price, description, category, unit } = data;

    if (!name || !name.trim()) {
      const err = new Error('Tên sản phẩm không được để trống!');
      err.statusCode = 400;
      throw err;
    }

    const cleanName = name.trim();
    if (cleanName.length > 200) {
      const err = new Error('Tên sản phẩm không được vượt quá 200 ký tự!');
      err.statusCode = 400;
      throw err;
    }

    const parsedPrice = Number(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      const err = new Error('Giá bán phải là số hợp lệ lớn hơn hoặc bằng 0!');
      err.statusCode = 400;
      throw err;
    }

    // Kiểm tra tên trùng lặp (không phân biệt hoa thường)
    const existing = await Product.findOne({
      name: { $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });
    if (existing) {
      const err = new Error(`Sản phẩm với tên "${cleanName}" đã tồn tại!`);
      err.statusCode = 409;
      throw err;
    }

    const newProduct = await Product.create({
      name: cleanName,
      price: parsedPrice,
      description: description ? description.trim() : '',
      stockQuantity: 0, // Tồn kho ban đầu luôn là 0, cập nhật qua UC-14.7 Stock In
      status: 'ACTIVE',
      category: category ? category.trim() : 'GENERAL',
      unit: unit ? unit.trim() : 'cái'
    });

    return newProduct;
  }

  /**
   * UC-14.4: Cập nhật thông tin sản phẩm (chỉ Admin)
   * Không cho phép chỉnh sửa tồn kho trực tiếp qua endpoint này
   */
  async updateProduct(productId, data) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      const err = new Error('Mã sản phẩm không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId);
    if (!product) {
      const err = new Error('Không tìm thấy sản phẩm!');
      err.statusCode = 404;
      throw err;
    }

    const updateFields = {};

    if (data.name !== undefined) {
      const cleanName = String(data.name).trim();
      if (!cleanName) {
        const err = new Error('Tên sản phẩm không được để trống!');
        err.statusCode = 400;
        throw err;
      }
      if (cleanName.length > 200) {
        const err = new Error('Tên sản phẩm không được vượt quá 200 ký tự!');
        err.statusCode = 400;
        throw err;
      }

      // Kiểm tra trùng tên với sản phẩm khác
      const duplicate = await Product.findOne({
        _id: { $ne: productId },
        name: { $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      });
      if (duplicate) {
        const err = new Error(`Tên sản phẩm "${cleanName}" đã được sử dụng bởi sản phẩm khác!`);
        err.statusCode = 409;
        throw err;
      }

      updateFields.name = cleanName;
    }

    if (data.price !== undefined) {
      const parsedPrice = Number(data.price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        const err = new Error('Giá bán phải là số hợp lệ lớn hơn hoặc bằng 0!');
        err.statusCode = 400;
        throw err;
      }
      updateFields.price = parsedPrice;
    }

    if (data.description !== undefined) {
      updateFields.description = String(data.description).trim();
    }

    if (data.category !== undefined) {
      updateFields.category = String(data.category).trim();
    }

    if (data.unit !== undefined) {
      updateFields.unit = String(data.unit).trim();
    }

    // Áp dụng cập nhật
    Object.assign(product, updateFields);
    await product.save();

    return product;
  }

  /**
   * UC-14.5: Vô hiệu hóa sản phẩm (chỉ Admin)
   * Không xóa cứng, bảo toàn dữ liệu lịch sử giao dịch
   */
  async deactivateProduct(productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      const err = new Error('Mã sản phẩm không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId);
    if (!product) {
      const err = new Error('Không tìm thấy sản phẩm!');
      err.statusCode = 404;
      throw err;
    }

    if (product.status === 'INACTIVE') {
      const err = new Error('Sản phẩm đã ở trạng thái ngưng kinh doanh (INACTIVE) trước đó!');
      err.statusCode = 400;
      throw err;
    }

    product.status = 'INACTIVE';
    await product.save();

    return product;
  }

  /**
   * Hỗ trợ kích hoạt lại sản phẩm
   */
  async activateProduct(productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      const err = new Error('Mã sản phẩm không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId);
    if (!product) {
      const err = new Error('Không tìm thấy sản phẩm!');
      err.statusCode = 404;
      throw err;
    }

    if (product.status === 'ACTIVE') {
      const err = new Error('Sản phẩm đã đang ở trạng thái hoạt động!');
      err.statusCode = 400;
      throw err;
    }

    product.status = 'ACTIVE';
    await product.save();

    return product;
  }

  /**
   * UC-14.7: Ghi nhận nhập hàng, tăng tồn kho và lưu thông tin giao dịch nhập kho
   * Sử dụng atomic update & transaction (khi replica set có sẵn) kèm idempotency key
   */
  async stockIn(productId, data, userId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      const err = new Error('Mã sản phẩm không hợp lệ!');
      err.statusCode = 400;
      throw err;
    }

    const { quantity, costPrice = 0, note = '', requestId } = data;

    const parsedQty = Number(quantity);
    if (isNaN(parsedQty) || !Number.isInteger(parsedQty) || parsedQty <= 0) {
      const err = new Error('Số lượng nhập phải là số nguyên dương lớn hơn 0!');
      err.statusCode = 400;
      throw err;
    }

    const parsedCost = Number(costPrice);
    if (isNaN(parsedCost) || parsedCost < 0) {
      const err = new Error('Giá nhập không được âm!');
      err.statusCode = 400;
      throw err;
    }

    // Cơ chế chống gửi lặp (idempotency requestId)
    if (requestId && typeof requestId === 'string' && requestId.trim()) {
      const existingTx = await StockInHistory.findOne({ requestId: requestId.trim() })
        .populate('performedBy', 'fullName email')
        .lean();
      if (existingTx) {
        const prod = await Product.findById(productId).lean();
        return {
          product: prod,
          stockMovement: existingTx,
          message: 'Yêu cầu nhập kho này đã được ghi nhận trước đó (Idempotent).'
        };
      }
    }

    // Kiểm tra và bắt đầu session/transaction nếu MongoDB có replica set / mongos
    let session = null;
    let isTransactionActive = false;

    try {
      session = await mongoose.startSession();
      // Thử start transaction; nếu standalone MongoDB sẽ ném lỗi khi thực thi lệnh đầu tiên
      session.startTransaction();
      isTransactionActive = true;
    } catch {
      session = null;
      isTransactionActive = false;
    }

    try {
      let product;
      let historyRecord;

      try {
        const sessionOpt = isTransactionActive && session ? { session } : {};

        product = await Product.findById(productId, null, sessionOpt);
        if (!product) {
          const err = new Error('Không tìm thấy sản phẩm!');
          err.statusCode = 404;
          throw err;
        }

        if (product.status === 'INACTIVE') {
          const err = new Error('Không thể nhập kho cho sản phẩm đã ngưng kinh doanh (INACTIVE)!');
          err.statusCode = 400;
          throw err;
        }

        const stockBefore = product.stockQuantity;
        const stockAfter = stockBefore + parsedQty;

        product.stockQuantity = stockAfter;
        await product.save(sessionOpt);

        const [createdRecord] = await StockInHistory.create(
          [
            {
              productId: product._id,
              quantity: parsedQty,
              costPrice: parsedCost,
              stockBefore,
              stockAfter,
              note: note ? note.trim() : '',
              performedBy: userId,
              requestId: requestId ? requestId.trim() : undefined
            }
          ],
          sessionOpt
        );
        historyRecord = createdRecord;

        if (isTransactionActive && session) {
          await session.commitTransaction();
        }
      } catch (txErr) {
        // Nếu lỗi do MongoDB là Standalone không hỗ trợ Transaction numbers (code 20 / IllegalOperation)
        if (
          isTransactionActive &&
          session &&
          (txErr.code === 20 || (txErr.message && txErr.message.includes('replica set')))
        ) {
          await session.abortTransaction().catch(() => {});
          session.endSession().catch(() => {});
          session = null;
          isTransactionActive = false;

          // Thực hiện theo cơ chế Atomic Rollback trực tiếp
          const directProduct = await Product.findById(productId);
          if (!directProduct) {
            const err = new Error('Không tìm thấy sản phẩm!');
            err.statusCode = 404;
            throw err;
          }
          if (directProduct.status === 'INACTIVE') {
            const err = new Error('Không thể nhập kho cho sản phẩm đã ngưng kinh doanh (INACTIVE)!');
            err.statusCode = 400;
            throw err;
          }

          const stockBefore = directProduct.stockQuantity;
          const stockAfter = stockBefore + parsedQty;

          // Cập nhật nguyên tử
          const updatedProduct = await Product.findOneAndUpdate(
            { _id: productId },
            { $inc: { stockQuantity: parsedQty } },
            { new: true }
          );

          try {
            historyRecord = await StockInHistory.create({
              productId: updatedProduct._id,
              quantity: parsedQty,
              costPrice: parsedCost,
              stockBefore,
              stockAfter,
              note: note ? note.trim() : '',
              performedBy: userId,
              requestId: requestId ? requestId.trim() : undefined
            });
            product = updatedProduct;
          } catch (createHistErr) {
            // Rollback lại số lượng tồn kho nếu ghi lịch sử thất bại
            await Product.findByIdAndUpdate(productId, { $inc: { stockQuantity: -parsedQty } });
            throw createHistErr;
          }
        } else {
          if (isTransactionActive && session) {
            await session.abortTransaction().catch(() => {});
          }
          throw txErr;
        }
      }

      return {
        product,
        stockMovement: historyRecord
      };
    } finally {
      if (session) {
        session.endSession().catch(() => {});
      }
    }
  }
}

module.exports = new ProductService();
