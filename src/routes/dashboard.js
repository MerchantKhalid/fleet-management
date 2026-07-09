const express = require('express');
const router = express.Router();
const prisma = require('../db');
const dayjs = require('dayjs');

router.get('/', async (req, res) => {
  const in30Days = dayjs().add(30, 'day').toDate();
  const in7Days = dayjs().add(7, 'day').toDate();
  const now = new Date();

  // --- Fleet Income date range (defaults to the current week, Mon-Sun) ---
  let { from, to } = req.query;
  if (!from && !to) {
    const day = dayjs().day(); // 0 (Sun) - 6 (Sat)
    const mondayOffset = (day + 6) % 7;
    from = dayjs().subtract(mondayOffset, 'day').format('YYYY-MM-DD');
    to = dayjs(from).add(6, 'day').format('YYYY-MM-DD');
  }
  const rangeStart = from ? dayjs(from).startOf('day').toDate() : undefined;
  const rangeEnd = to ? dayjs(to).endOf('day').toDate() : undefined;

  const settlementWhere = {};
  if (rangeStart || rangeEnd) {
    settlementWhere.weekStart = {};
    if (rangeStart) settlementWhere.weekStart.gte = rangeStart;
    if (rangeEnd) settlementWhere.weekStart.lte = rangeEnd;
  }

  const expenseWhere = {};
  if (rangeStart || rangeEnd) {
    expenseWhere.date = {};
    if (rangeStart) expenseWhere.date.gte = rangeStart;
    if (rangeEnd) expenseWhere.date.lte = rangeEnd;
  }

  const [activeDrivers, activeCars, settlementsInRange, expensesInRange, customPaymentsInRange] = await Promise.all([
    prisma.driver.count({ where: { status: 'ACTIVE' } }),
    prisma.car.count({ where: { status: 'ACTIVE' } }),
    prisma.weeklySettlement.findMany({ where: settlementWhere, include: { car: true } }),
    prisma.expense.findMany({ where: expenseWhere }),
    prisma.customPayment.findMany({ where: expenseWhere }),
  ]);

  // Fleet charges €25/week per car; €5 of that goes to the car's manager/owner (if it has one);
  // the fleet keeps the rest (typically €20).
  let fleetChargeTotal = 0;
  let managerFeeTotal = 0;
  settlementsInRange.forEach((s) => {
    fleetChargeTotal += s.fleetCharge;
    if (s.car && s.car.ownerId) {
      managerFeeTotal += s.car.managerFee;
    }
  });
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
    fleetNetFromCars,
    expensesTotal,
    customPaymentsTotal,
    finalNetIncome,
    settlementCount: settlementsInRange.length,
  });
});

module.exports = router;
