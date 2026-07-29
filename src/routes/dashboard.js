const express = require('express');
const router = express.Router();
const prisma = require('../db');
const dayjs = require('dayjs');

router.get('/', async (req, res) => {
  const in30Days = dayjs().add(30, 'day').toDate();
  const in7Days = dayjs().add(7, 'day').toDate();
  const now = new Date();

  let { from, to } = req.query;
  if (!from && !to) {
    const day = dayjs().day();
    const mondayOffset = (day + 6) % 7;
    from = dayjs().subtract(mondayOffset, 'day').format('YYYY-MM-DD');
    to = dayjs(from).add(6, 'day').format('YYYY-MM-DD');
  }
  const rangeStart = from ? dayjs(from).startOf('day').toDate() : undefined;
  const rangeEnd = to ? dayjs(to).endOf('day').toDate() : undefined;

  const expenseWhere = {};
  if (rangeStart || rangeEnd) {
    expenseWhere.date = {};
    if (rangeStart) expenseWhere.date.gte = rangeStart;
    if (rangeEnd) expenseWhere.date.lte = rangeEnd;
  }

  const [activeDriversCount, activeCarsList, expensesInRange, customPaymentsInRange, override] = await Promise.all([
    prisma.driver.count({ where: { status: 'ACTIVE' } }),
    prisma.car.findMany({ where: { status: 'ACTIVE' }, select: { weeklyRentalCost: true, managerFee: true } }),
    prisma.expense.findMany({ where: expenseWhere }),
    prisma.customPayment.findMany({ where: expenseWhere }),
    rangeStart && rangeEnd
      ? prisma.fleetIncomeOverride.findUnique({ where: { weekStart_weekEnd: { weekStart: rangeStart, weekEnd: rangeEnd } } })
      : null,
  ]);

  const activeDrivers = activeDriversCount;
  const activeCars = activeCarsList.length;

  const calculatedFleetChargeTotal = activeCarsList.reduce((sum, c) => sum + (c.weeklyRentalCost || 0), 0);
  const calculatedManagerFeeTotal = activeCarsList.reduce((sum, c) => sum + (c.managerFee || 0), 0);
  const fleetChargeTotal = override ? override.fleetChargeTotal : calculatedFleetChargeTotal;
  const managerFeeTotal = override ? override.managerFeeTotal : calculatedManagerFeeTotal;
  const isOverridden = !!override;
  const fleetNetFromCars = fleetChargeTotal - managerFeeTotal;
  const expensesTotal = expensesInRange.reduce((sum, e) => sum + e.amount, 0);
  const customPaymentsTotal = customPaymentsInRange.reduce((sum, p) => sum + p.amount, 0);
  const finalNetIncome = fleetNetFromCars + customPaymentsTotal - expensesTotal;

  const [expiringInsurance, expiringCartaVerde, dueMaintenance] = await Promise.all([
    prisma.insurance.findMany({ where: { expiryDate: { lte: in30Days, gte: now } }, include: { car: true } }),
    prisma.insurance.findMany({ where: { cartaVerdeEndDate: { lte: in7Days, gte: now } }, include: { car: true } }),
    prisma.maintenanceLog.findMany({ where: { nextServiceDue: { lte: in30Days, gte: now } }, include: { car: true } }),
  ]);

  const alerts = [
    ...expiringInsurance.map((i) => `Insurance on ${i.car.plate} expires ${dayjs(i.expiryDate).format('DD MMM YYYY')}`),
    ...expiringCartaVerde.map((i) => `⚠ Carta Verde for ${i.car.plate} expires ${dayjs(i.cartaVerdeEndDate).format('DD MMM YYYY')} (within 7 days)`),
    ...dueMaintenance.map((m) => `Service due on ${m.car.plate} by ${dayjs(m.nextServiceDue).format('DD MMM YYYY')}`),
  ];

  res.render('dashboard', {
    activeDrivers,
    activeCars,
    alerts,
    from,
    to,
    fleetChargeTotal,
    managerFeeTotal,
    calculatedFleetChargeTotal,
    calculatedManagerFeeTotal,
    isOverridden,
    fleetNetFromCars,
    expensesTotal,
    customPaymentsTotal,
    finalNetIncome,
  });
});

router.post('/fleet-totals', async (req, res) => {
  const { from, to, fleetChargeTotal, managerFeeTotal } = req.body;
  const weekStart = dayjs(from).startOf('day').toDate();
  const weekEnd = dayjs(to).endOf('day').toDate();

  await prisma.fleetIncomeOverride.upsert({
    where: { weekStart_weekEnd: { weekStart, weekEnd } },
    update: {
      fleetChargeTotal: Number(fleetChargeTotal || 0),
      managerFeeTotal: Number(managerFeeTotal || 0),
    },
    create: {
      weekStart,
      weekEnd,
      fleetChargeTotal: Number(fleetChargeTotal || 0),
      managerFeeTotal: Number(managerFeeTotal || 0),
    },
  });

  res.redirect(`/?from=${from}&to=${to}`);
});

router.post('/fleet-totals/clear', async (req, res) => {
  const { from, to } = req.body;
  const weekStart = dayjs(from).startOf('day').toDate();
  const weekEnd = dayjs(to).endOf('day').toDate();

  await prisma.fleetIncomeOverride.deleteMany({ where: { weekStart, weekEnd } });

  res.redirect(`/?from=${from}&to=${to}`);
});

module.exports = router;