const express = require('express');
const router = express.Router();
const prisma = require('../db');

// LIST + FILTER BY DATE + ADD FORM
router.get('/', async (req, res) => {
  const { from, to } = req.query;

  const where = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }

  const payments = await prisma.customPayment.findMany({
    where,
    orderBy: { date: 'desc' },
  });

  const total = payments.reduce((sum, p) => sum + p.amount, 0);

  res.render('customPayments/index', { payments, total, from: from || '', to: to || '' });
});

// CREATE
router.post('/', async (req, res) => {
  const { name, amount, date, notes } = req.body;
  await prisma.customPayment.create({
    data: {
      name,
      amount: Number(amount || 0),
      date: date ? new Date(date) : new Date(),
      notes: notes || null,
    },
  });
  res.redirect('/custom-payments');
});

// DELETE
router.delete('/:id', async (req, res) => {
  await prisma.customPayment.delete({ where: { id: req.params.id } });
  res.redirect('/custom-payments');
});

module.exports = router;
