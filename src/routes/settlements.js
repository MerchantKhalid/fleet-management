const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { createSettlement } = require('../services/settlementService');

// LIST + ADD FORM
router.get('/', async (req, res) => {
  const { from, to } = req.query;

  const where = {};
  if (from || to) {
    where.weekStart = {};
    if (from) where.weekStart.gte = new Date(from);
    if (to) where.weekStart.lte = new Date(to);
  }

  const [settlements, drivers] = await Promise.all([
    prisma.weeklySettlement.findMany({
      where,
      include: { driver: true, car: true },
      orderBy: { weekStart: 'desc' },
      take: from || to ? undefined : 50,
    }),
    prisma.driver.findMany({ where: { status: 'ACTIVE' }, include: { currentCar: true } }),
  ]);
  res.render('settlements/index', { settlements, drivers, from: from || '', to: to || '' });
});

// CREATE (calculates + saves + creates linked IVA refund)
router.post('/', async (req, res) => {
  const driver = await prisma.driver.findUnique({ where: { id: req.body.driverId }, include: { currentCar: true } });
  await createSettlement({
    ...req.body,
    carId: driver?.currentCar?.id || null,
  });
  res.redirect('/settlements');
});

// MARK AS PAID
router.post('/:id/pay', async (req, res) => {
  await prisma.weeklySettlement.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidAt: new Date() },
  });
  res.redirect('/settlements');
});

module.exports = router;
