const express = require('express');
const router = express.Router();
const prisma = require('../db');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');

router.get('/', async (req, res) => {
  const drivers = await prisma.driver.findMany();
  const settlements = await prisma.weeklySettlement.findMany({
    include: { driver: true },
    orderBy: { weekStart: 'desc' },
    take: 100,
  });
  res.render('export', { drivers, settlements });
});

// CSV export — all settlements in a given week (optionally filtered by driver)
router.get('/csv', async (req, res) => {
  const { weekStart, driverId } = req.query;

  const where = {};
  if (weekStart) where.weekStart = new Date(weekStart);
  if (driverId) where.driverId = driverId;

  const settlements = await prisma.weeklySettlement.findMany({
    where,
    include: { driver: true, car: true },
    orderBy: { weekStart: 'desc' },
  });

  const header = [
    'Driver', 'Car', 'Week Start', 'Week End', 'Uber', 'Bolt', 'Gross',
    'Fleet Charge', 'IVA Withheld', 'Fuel/Electric', 'Via Verde', 'Other', 'Net Paid', 'Status',
  ];

  const rows = settlements.map((s) => [
    s.driver.name,
    s.car ? s.car.plate : '',
    dayjs(s.weekStart).format('YYYY-MM-DD'),
    dayjs(s.weekEnd).format('YYYY-MM-DD'),
    s.uberGross.toFixed(2),
    s.boltGross.toFixed(2),
    (s.uberGross + s.boltGross).toFixed(2),
    s.fleetCharge.toFixed(2),
    s.ivaWithheld.toFixed(2),
    s.fuelElectricCost.toFixed(2),
    s.viaVerde.toFixed(2),
    s.otherDeductions.toFixed(2),
    s.netPaid.toFixed(2),
    s.status,
  ]);

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="settlements_${Date.now()}.csv"`);
  res.send(csv);
});

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// CSV export — Fleet Income breakdown for a date range (mirrors the Dashboard panel)
router.get('/fleet-income-csv', async (req, res) => {
  const { from, to } = req.query;

  const rangeStart = from ? dayjs(from).startOf('day').toDate() : undefined;
  const rangeEnd = to ? dayjs(to).endOf('day').toDate() : undefined;

  const settlementWhere = {};
  if (rangeStart || rangeEnd) {
    settlementWhere.weekStart = {};
    if (rangeStart) settlementWhere.weekStart.gte = rangeStart;
    if (rangeEnd) settlementWhere.weekStart.lte = rangeEnd;
  }
  const dateWhere = {};
  if (rangeStart || rangeEnd) {
    dateWhere.date = {};
    if (rangeStart) dateWhere.date.gte = rangeStart;
    if (rangeEnd) dateWhere.date.lte = rangeEnd;
  }

  const [settlements, expenses, customPayments] = await Promise.all([
    prisma.weeklySettlement.findMany({ where: settlementWhere, include: { car: true }, orderBy: { weekStart: 'desc' } }),
    prisma.expense.findMany({ where: dateWhere, orderBy: { date: 'desc' } }),
    prisma.customPayment.findMany({ where: dateWhere, orderBy: { date: 'desc' } }),
  ]);

  let fleetChargeTotal = 0;
  let managerFeeTotal = 0;
  settlements.forEach((s) => {
    fleetChargeTotal += s.fleetCharge;
    if (s.car && s.car.ownerId) managerFeeTotal += s.car.managerFee;
  });
  const fleetNetFromCars = fleetChargeTotal - managerFeeTotal;
  const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const customPaymentsTotal = customPayments.reduce((sum, p) => sum + p.amount, 0);
  const finalNetIncome = fleetNetFromCars + customPaymentsTotal - expensesTotal;

  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvEscape).join(','));

  row('Fleet Income Report');
  row('From', from || '(all)');
  row('To', to || '(all)');
  row();

  row('Summary');
  row('Item', 'Amount');
  row('Fleet Charge Collected', fleetChargeTotal.toFixed(2));
  row('Manager Fees Paid Out', (-managerFeeTotal).toFixed(2));
  row('Fleet Net (before expenses)', fleetNetFromCars.toFixed(2));
  row('Custom Payments', customPaymentsTotal.toFixed(2));
  row('Expenses', (-expensesTotal).toFixed(2));
  row('Final Fleet Net Income', finalNetIncome.toFixed(2));
  row();

  row('Per-Car Charge Breakdown');
  row('Car Plate', 'Fleet Charge', 'Manager Fee', 'Fleet Net');
  settlements.forEach((s) => {
    const fee = s.car && s.car.ownerId ? s.car.managerFee : 0;
    row(s.car ? s.car.plate : '(no car)', s.fleetCharge.toFixed(2), fee.toFixed(2), (s.fleetCharge - fee).toFixed(2));
  });
  row();

  row('Custom Payments');
  row('Date', 'Name', 'Notes', 'Amount');
  customPayments.forEach((p) => {
    row(dayjs(p.date).format('YYYY-MM-DD'), p.name, p.notes || '', p.amount.toFixed(2));
  });
  row();

  row('Expenses');
  row('Date', 'Name', 'Notes', 'Amount');
  expenses.forEach((e) => {
    row(dayjs(e.date).format('YYYY-MM-DD'), e.name, e.notes || '', e.amount.toFixed(2));
  });

  const csv = lines.join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="fleet_income_${from || 'all'}_${to || 'all'}.csv"`);
  res.send(csv);
});

// PDF payslip for a single settlement
router.get('/pdf/:settlementId', async (req, res) => {
  const settlement = await prisma.weeklySettlement.findUnique({
    where: { id: req.params.settlementId },
    include: { driver: true, car: true },
  });

  if (!settlement) return res.status(404).send('Settlement not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip_${settlement.driver.name.replace(/\s+/g, '_')}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text('Weekly Payslip', { align: 'center' });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Driver: ${settlement.driver.name}`);
  doc.text(`Car: ${settlement.car ? settlement.car.plate : '-'}`);
  doc.text(`Week: ${dayjs(settlement.weekStart).format('DD MMM YYYY')} - ${dayjs(settlement.weekEnd).format('DD MMM YYYY')}`);
  doc.moveDown();

  const line = (label, value) => doc.text(`${label}: ${Number(value).toFixed(2)}`);

  line('Uber Earnings', settlement.uberGross);
  line('Bolt Earnings', settlement.boltGross);
  line('Gross Total', settlement.uberGross + settlement.boltGross);
  doc.moveDown(0.5);
  line('- Fleet Charge', settlement.fleetCharge);
  line('- IVA Withheld (6%)', settlement.ivaWithheld);
  line('- Fuel/Electric', settlement.fuelElectricCost);
  line('- Via Verde', settlement.viaVerde);
  line('- Other Deductions', settlement.otherDeductions);
  doc.moveDown(0.5);
  doc.fontSize(13).text(`Net Paid: ${settlement.netPaid.toFixed(2)}`, { underline: true });

  doc.end();
});

module.exports = router;
