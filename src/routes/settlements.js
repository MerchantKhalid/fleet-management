const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { createSettlement, calculate } = require('../services/settlementService');

// LIST + ADD FORM
router.get('/', async (req, res) => {
  const { from, to } = req.query;

  const where = {};
  if (from || to) {
    where.weekStart = {};
    if (from) where.weekStart.gte = new Date(from);
    if (to) where.weekStart.lte = new Date(to);
  }

  const hasFilter = Boolean(from || to);

  const [settlements, drivers] = await Promise.all([
    hasFilter
      ? prisma.weeklySettlement.findMany({
          where,
          include: { driver: true, car: true },
          orderBy: { weekStart: 'desc' },
        })
      : Promise.resolve([]),
    prisma.driver.findMany({ where: { status: 'ACTIVE' }, include: { currentCar: true } }),
  ]);
  res.render('settlements/index', { settlements, drivers, from: from || '', to: to || '', hasFilter });
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

// EDIT FORM
router.get('/:id/edit', async (req, res) => {
  const [settlement, drivers] = await Promise.all([
    prisma.weeklySettlement.findUnique({ where: { id: req.params.id }, include: { driver: true } }),
    prisma.driver.findMany({ where: { status: 'ACTIVE' }, include: { currentCar: true } }),
  ]);
  if (!settlement) return res.redirect('/settlements');
  res.render('settlements/edit', { settlement, drivers });
});

// UPDATE (recalculates totals + keeps the linked IVA refund in sync)
router.put('/:id', async (req, res) => {
  const existing = await prisma.weeklySettlement.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.redirect('/settlements');

  const driver = await prisma.driver.findUnique({ where: { id: req.body.driverId }, include: { currentCar: true } });
  const { ivaWithheld, netPaid } = calculate(req.body);

  await prisma.weeklySettlement.update({
    where: { id: req.params.id },
    data: {
      driverId: req.body.driverId,
      carId: driver?.currentCar?.id || existing.carId,
      weekStart: new Date(req.body.weekStart),
      weekEnd: new Date(req.body.weekEnd),
      uberGross: Number(req.body.uberGross || 0),
      boltGross: Number(req.body.boltGross || 0),
      fleetCharge: Number(req.body.fleetCharge || 0),
      ivaWithheld,
      fuelElectricCost: Number(req.body.fuelElectricCost || 0),
      viaVerde: Number(req.body.viaVerde || 0),
      otherDeductions: Number(req.body.otherDeductions || 0),
      netPaid,
    },
  });

  // Keep the linked IVA refund (created alongside the original settlement) in sync
  const linkedRefund = await prisma.ivaRefund.findFirst({
    where: { driverId: existing.driverId, periodStart: existing.weekStart, periodEnd: existing.weekEnd },
  });
  if (linkedRefund) {
    await prisma.ivaRefund.update({
      where: { id: linkedRefund.id },
      data: {
        driverId: req.body.driverId,
        periodStart: new Date(req.body.weekStart),
        periodEnd: new Date(req.body.weekEnd),
        amount: ivaWithheld,
      },
    });
  }

  res.redirect('/settlements');
});

// DELETE (also removes the linked IVA refund so refund totals stay accurate)
router.delete('/:id', async (req, res) => {
  const existing = await prisma.weeklySettlement.findUnique({ where: { id: req.params.id } });
  if (existing) {
    await prisma.ivaRefund.deleteMany({
      where: { driverId: existing.driverId, periodStart: existing.weekStart, periodEnd: existing.weekEnd },
    });
    await prisma.weeklySettlement.delete({ where: { id: req.params.id } });
  }
  res.redirect('/settlements');
});

module.exports = router;