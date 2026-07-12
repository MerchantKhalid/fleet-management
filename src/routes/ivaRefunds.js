const express = require('express');
const router = express.Router();
const prisma = require('../db');

router.get('/', async (req, res) => {
  const { from, to } = req.query;

  const where = {};
  if (from || to) {
    where.periodStart = {};
    if (from) where.periodStart.gte = new Date(from);
    if (to) where.periodStart.lte = new Date(to);
  }

  const refunds = await prisma.ivaRefund.findMany({
    where,
    include: { driver: true },
    orderBy: { periodStart: 'desc' },
  });
  res.render('ivaRefunds/index', { refunds, from: from || '', to: to || '' });
});

router.post('/:id/refund', async (req, res) => {
  const { receiptRef, refundDate } = req.body;
  await prisma.ivaRefund.update({
    where: { id: req.params.id },
    data: {
      status: 'REFUNDED',
      refundedAt: refundDate ? new Date(refundDate) : new Date(),
      receiptRef: receiptRef || null,
    },
  });
  res.redirect('/iva-refunds');
});

module.exports = router;
