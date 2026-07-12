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

// PDF export — Fleet Income breakdown for a date range (mirrors the Dashboard panel)
router.get('/fleet-income-pdf', async (req, res) => {
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

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fleet_income_${from || 'all'}_${to || 'all'}.pdf"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(16).text('Fleet Income Report', { align: 'center' });
  doc.fontSize(9).fillColor('#555').text(
    `From: ${from || '(all)'}   To: ${to || '(all)'}   |   Generated ${dayjs().format('DD MMM YYYY HH:mm')}`,
    { align: 'center' }
  );
  doc.moveDown(1);
  doc.fillColor('#000');

  const summaryRow = (label, value, opts = {}) => {
    doc.fontSize(opts.bold ? 11 : 10).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, doc.page.margins.left, doc.y, { continued: true, width: 350 });
    doc.text(value, { align: 'right' });
    doc.moveDown(0.3);
  };

  doc.fontSize(12).font('Helvetica-Bold').text('Summary');
  doc.moveDown(0.3);
  summaryRow('Fleet Charge Collected', `€${fleetChargeTotal.toFixed(2)}`);
  summaryRow('Manager Fees Paid Out', `-€${managerFeeTotal.toFixed(2)}`);
  summaryRow('Fleet Net (before expenses)', `€${fleetNetFromCars.toFixed(2)}`);
  summaryRow('Custom Payments', `+€${customPaymentsTotal.toFixed(2)}`);
  summaryRow('Expenses', `-€${expensesTotal.toFixed(2)}`);
  summaryRow('Final Fleet Net Income', `€${finalNetIncome.toFixed(2)}`, { bold: true });
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(12).text('Per-Car Charge Breakdown');
  doc.moveDown(0.3);
  const carCols = [
    { label: 'Car Plate', width: 150 },
    { label: 'Fleet Charge', width: 120 },
    { label: 'Manager Fee', width: 120 },
    { label: 'Fleet Net', width: 120 },
  ];
  let x = doc.page.margins.left;
  let y = doc.y;
  doc.fontSize(9).font('Helvetica-Bold');
  carCols.forEach((c) => { doc.text(c.label, x, y, { width: c.width }); x += c.width; });
  doc.moveTo(doc.page.margins.left, y + 13).lineTo(x, y + 13).strokeColor('#ccc').stroke();
  y += 18;
  doc.font('Helvetica');
  settlements.forEach((s) => {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const fee = s.car && s.car.ownerId ? s.car.managerFee : 0;
    const rowVals = [s.car ? s.car.plate : '(no car)', `€${s.fleetCharge.toFixed(2)}`, `€${fee.toFixed(2)}`, `€${(s.fleetCharge - fee).toFixed(2)}`];
    x = doc.page.margins.left;
    rowVals.forEach((val, i) => { doc.text(val, x, y, { width: carCols[i].width }); x += carCols[i].width; });
    y += 16;
  });
  doc.y = y + 10;

  if (customPayments.length) {
    doc.font('Helvetica-Bold').fontSize(12).text('Custom Payments', doc.page.margins.left, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9);
    customPayments.forEach((p) => {
      doc.text(`${dayjs(p.date).format('DD MMM YYYY')}  —  ${p.name}${p.notes ? ' (' + p.notes + ')' : ''}  —  €${p.amount.toFixed(2)}`);
    });
    doc.moveDown(0.8);
  }

  if (expenses.length) {
    doc.font('Helvetica-Bold').fontSize(12).text('Expenses', doc.page.margins.left, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9);
    expenses.forEach((e) => {
      doc.text(`${dayjs(e.date).format('DD MMM YYYY')}  —  ${e.name}${e.notes ? ' (' + e.notes + ')' : ''}  —  €${e.amount.toFixed(2)}`);
    });
  }

  doc.end();
});

// PDF export — all settlements in a given week (optionally filtered by driver), mirrors the CSV export
router.get('/pdf-report', async (req, res) => {
  const { weekStart, driverId } = req.query;

  const where = {};
  if (weekStart) where.weekStart = new Date(weekStart);
  if (driverId) where.driverId = driverId;

  const settlements = await prisma.weeklySettlement.findMany({
    where,
    include: { driver: true, car: true },
    orderBy: { weekStart: 'desc' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="settlements_${Date.now()}.pdf"`);

  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  doc.fontSize(16).text('Settlements Report', { align: 'center' });
  doc.fontSize(9).fillColor('#555').text(
    `${weekStart ? 'Week Start: ' + dayjs(weekStart).format('DD MMM YYYY') : 'All weeks'}${driverId ? '  |  Driver filtered' : ''}  |  Generated ${dayjs().format('DD MMM YYYY HH:mm')}`,
    { align: 'center' }
  );
  doc.moveDown(1);
  doc.fillColor('#000');

  const cols = [
    { label: 'Driver', width: 100 },
    { label: 'Car', width: 55 },
    { label: 'Week', width: 90 },
    { label: 'Gross', width: 60 },
    { label: 'Fleet Chg', width: 60 },
    { label: 'IVA', width: 55 },
    { label: 'Fuel/Elec', width: 60 },
    { label: 'Via Verde', width: 60 },
    { label: 'Net Paid', width: 65 },
    { label: 'Status', width: 55 },
  ];
  const tableLeft = doc.page.margins.left;
  const rowHeight = 20;

  function drawHeader(y) {
    let x = tableLeft;
    doc.fontSize(8).font('Helvetica-Bold');
    cols.forEach((c) => {
      doc.text(c.label, x, y, { width: c.width, align: 'left' });
      x += c.width;
    });
    doc.moveTo(tableLeft, y + 14).lineTo(x, y + 14).strokeColor('#ccc').stroke();
    doc.font('Helvetica');
  }

  let y = doc.y;
  drawHeader(y);
  y += rowHeight;

  let totalNet = 0;
  settlements.forEach((s) => {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader(y);
      y += rowHeight;
    }
    const gross = s.uberGross + s.boltGross;
    totalNet += s.netPaid;
    const cells = [
      s.driver.name,
      s.car ? s.car.plate : '-',
      `${dayjs(s.weekStart).format('DD MMM')} - ${dayjs(s.weekEnd).format('DD MMM')}`,
      `€${gross.toFixed(2)}`,
      `€${s.fleetCharge.toFixed(2)}`,
      `€${s.ivaWithheld.toFixed(2)}`,
      `€${s.fuelElectricCost.toFixed(2)}`,
      `€${s.viaVerde.toFixed(2)}`,
      `€${s.netPaid.toFixed(2)}`,
      s.status,
    ];
    let x = tableLeft;
    doc.fontSize(8);
    cells.forEach((val, i) => {
      doc.text(String(val), x, y, { width: cols[i].width, align: 'left' });
      x += cols[i].width;
    });
    y += rowHeight;
  });

  doc.moveTo(tableLeft, y).lineTo(tableLeft + cols.reduce((a, c) => a + c.width, 0), y).strokeColor('#ccc').stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(9).text(`Total Net Paid: €${totalNet.toFixed(2)}`, tableLeft, y);

  doc.end();
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