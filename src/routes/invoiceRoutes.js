const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const authMiddleware = require('../middlewares/authMiddleware');
const staffOrAdminMiddleware = require('../middlewares/staffOrAdminMiddleware');

router.use(authMiddleware, staffOrAdminMiddleware);

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.post('/validate-voucher', invoiceController.validateVoucherForInvoice);
router.post('/:id/settle', invoiceController.settleSessionInvoice);
router.post('/pos', invoiceController.createPosPayment);

module.exports = router;
