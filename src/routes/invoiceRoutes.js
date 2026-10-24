const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticateUser, authorizeRole } = require('../middlewares/authMiddleware');

router.use(authenticateUser, authorizeRole(['STAFF', 'ADMIN']));

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.post('/validate-voucher', invoiceController.validateVoucherForInvoice);
router.post('/:id/settle', invoiceController.settleSessionInvoice);
router.post('/pos', invoiceController.createPosPayment);

module.exports = router;
