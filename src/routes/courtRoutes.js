const router = require('express').Router();
const courtController = require('../controllers/courtController');

router.get('/public', courtController.getPublicCourts);
module.exports = router;