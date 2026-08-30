const express = require('express');
const router = express.Router();
const prisma = require('../db');

const PAGE_SIZE = 10;

router.get('/', async (req, res) => {
  const { from, to } = req.query;

  // Pagination params (?page=2)
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = {};
  if (from || to) {
    where.periodStart = {};
    if (from) where.periodStart.gte = new Date(from);
    if (to) where.periodStart.lte = new Date(to);
  }

  const [refunds, totalCount, drivers] = await Promise.all([
    prisma.ivaRefund.findMany({
      where,
      include: { driver: true },
      orderBy: { periodStart: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.ivaRefund.count({ where }),
    prisma.driver.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  res.render('ivaRefunds/index', {
    refunds,
    from: from || '',
    to: to || '',
    drivers,
    page,
    totalPages,
    totalCount,
  });
});

// CREATE — manually add an IVA refund entry with a custom amount
router.post('/', async (req, res) => {
  const { driverId, periodStart, periodEnd, amount, receiptRef, status, refundedAt } = req.body;

  await prisma.ivaRefund.create({
    data: {
      driverId,
      period: periodStart ? periodStart.slice(0, 7) : '',
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      amount: Number(amount || 0),
      receiptRef: receiptRef || null,
      status: status === 'REFUNDED' ? 'REFUNDED' : 'WITHHELD',
      refundedAt: status === 'REFUNDED' ? (refundedAt ? new Date(refundedAt) : new Date()) : null,
    },
  });
  res.redirect('/iva-refunds');
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
