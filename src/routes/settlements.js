const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { createSettlement, calculate } = require('../services/settlementService');

// Builds a "?from=...&to=..." query string from posted hidden filter fields (if any were carried along).
function buildQuery({ from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// Most recently completed Monday–Sunday week, used as the default range for batch entry.
function getPreviousWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(now);
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(now.getDate() + diffToMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return { start: lastMonday, end: lastSunday };
}

function toDateInputValue(d) {
  return d.toISOString().slice(0, 10);
}

const BATCH_FIELDS = ['uberGross', 'boltGross', 'fleetCharge', 'fuelElectricCost', 'viaVerde', 'otherDeductions'];

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
  // Jump straight into a filter covering this settlement's week so it's visible immediately,
  // without the user having to apply the date filter by hand.
  res.redirect(`/settlements?from=${req.body.weekStart}&to=${req.body.weekEnd}`);
});

// BATCH WEEKLY ENTRY — pick a week once, fill every driver's numbers in one table, save all at once.
router.get('/batch', async (req, res) => {
  let { from, to } = req.query;
  if (!from || !to) {
    const { start, end } = getPreviousWeekRange();
    from = toDateInputValue(start);
    to = toDateInputValue(end);
  }

  const drivers = await prisma.driver.findMany({
    where: { status: 'ACTIVE' },
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });

  const existing = await prisma.weeklySettlement.findMany({
    where: { weekStart: new Date(from), driverId: { in: drivers.map(d => d.id) } },
  });
  const existingByDriver = {};
  existing.forEach(s => { existingByDriver[s.driverId] = s; });

  res.render('settlements/batch', { drivers, from, to, existingByDriver });
});

router.post('/batch', async (req, res) => {
  const { weekStart, weekEnd, drivers: rows } = req.body;

  if (rows && weekStart && weekEnd) {
    const driverIds = Object.keys(rows);

    const [driverRecords, existing] = await Promise.all([
      prisma.driver.findMany({ where: { id: { in: driverIds } }, include: { currentCar: true } }),
      prisma.weeklySettlement.findMany({ where: { weekStart: new Date(weekStart), driverId: { in: driverIds } } }),
    ]);
    const driverMap = {};
    driverRecords.forEach(d => { driverMap[d.id] = d; });
    const alreadySaved = new Set(existing.map(s => s.driverId));

    for (const driverId of driverIds) {
      if (alreadySaved.has(driverId)) continue; // never overwrite/duplicate an existing settlement for that week
      const row = rows[driverId] || {};
      const hasAnyValue = BATCH_FIELDS.some(k => Number(row[k] || 0) !== 0);
      if (!hasAnyValue) continue; // skip rows the manager left blank

      const driver = driverMap[driverId];
      await createSettlement({
        driverId,
        carId: driver?.currentCar?.id || null,
        weekStart,
        weekEnd,
        ...row,
      });
    }
  }

  res.redirect(`/settlements?from=${weekStart}&to=${weekEnd}`);
});

// MARK AS PAID
router.post('/:id/pay', async (req, res) => {
  await prisma.weeklySettlement.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidAt: new Date() },
  });
  res.redirect(`/settlements${buildQuery(req.body)}`);
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

  res.redirect(`/settlements?from=${req.body.weekStart}&to=${req.body.weekEnd}`);
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
  res.redirect(`/settlements${buildQuery(req.body)}`);
});

module.exports = router;