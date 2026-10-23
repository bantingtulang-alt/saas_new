const router = require('express').Router();

router.use(require('./api/auth'));
router.use(require('./api/modules'));
router.use(require('./api/items'));
router.use(require('./api/customers'));
router.use(require('./api/sales'));
router.use(require('./api/finance'));
router.use(require('./reports'));
router.use(require('./api/whatsapp'));
router.use(require('./api/workflows'));
router.use(require('./api/admin'));
router.use(require('./api/permissions'));

module.exports = router;
