const mongoose = require('mongoose');
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, { retryWrites: false });
        console.log(`[Database] MongoDB đã kết nối thành công: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[Database] Lỗi kết nối MongoDB: ${error.message}`);
        process.exit(1);
    }
};
module.exports = { connectDB };