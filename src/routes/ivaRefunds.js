const express = require('express');
const router = express.Router();
const prisma = require('../db');

router.get('/', async (req, res) => {
  const refunds = await prisma.ivaRefund.findMany({
    include: { driver: true },
    orderBy: { period: 'desc' },
  });
  res.render('ivaRefunds/index', { refunds });
});

router.post('/:id/refund', async (req, res) => {
  const { receiptRef } = req.body;
  await prisma.ivaRefund.update({
    where: { id: req.params.id },
    data: { status: 'REFUNDED', refundedAt: new Date(), receiptRef: receiptRef || null },
  });
  res.redirect('/iva-refunds');
});

module.exports = router;
