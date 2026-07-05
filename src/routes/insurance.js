const express = require('express');
const router = express.Router();
const prisma = require('../db');

router.get('/', async (req, res) => {
  const [policies, cars] = await Promise.all([
    prisma.insurance.findMany({ include: { car: true }, orderBy: { expiryDate: 'asc' } }),
    prisma.car.findMany({ where: { status: { not: 'RETIRED' } } }),
  ]);
  res.render('insurance/index', { policies, cars });
});

router.post('/', async (req, res) => {
  const { carId, insurer, policyNumber, cost, billingPeriod, paidBy, expiryDate } = req.body;
  await prisma.insurance.create({
    data: {
      carId,
      insurer,
      policyNumber: policyNumber || null,
      cost: Number(cost || 0),
      billingPeriod,
      paidBy,
      expiryDate: new Date(expiryDate),
    },
  });
  res.redirect('/insurance');
});

router.delete('/:id', async (req, res) => {
  await prisma.insurance.delete({ where: { id: req.params.id } });
  res.redirect('/insurance');
});

module.exports = router;
