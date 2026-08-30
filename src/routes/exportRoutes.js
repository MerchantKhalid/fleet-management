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

// PDF export — ALL drivers' earnings details together (combined payslips),
// using the same from/to (weekStart) range filter as the Settlement History page
router.get('/all-payslips', async (req, res) => {
  const { from, to, driverId } = req.query;

  const where = {};
  if (from || to) {
    where.weekStart = {};
    if (from) where.weekStart.gte = new Date(from);
    if (to) where.weekStart.lte = new Date(to);
  }
  if (driverId) where.driverId = driverId;

  const settlements = await prisma.weeklySettlement.findMany({
    where,
    include: { driver: true, car: true },
    orderBy: [{ driver: { name: 'asc' } }, { weekStart: 'asc' }],
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="all_driver_payslips_${Date.now()}.pdf"`);

  const doc = new PDFDocument({ margin: 32, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  if (settlements.length === 0) {
    doc.fontSize(14).text('NO SETTLEMENTS FOUND FOR THIS RANGE.', { align: 'center' });
    doc.end();
    return;
  }

  // Header
  doc.fontSize(17).font('Helvetica-Bold').fillColor('#000').text('ALL DRIVER PAYSLIPS', { align: 'center' });
  doc.fontSize(9).font('Helvetica').fillColor('#666').text(
    `${from ? 'FROM: ' + dayjs(from).format('DD MMM YYYY').toUpperCase() + '   ' : ''}${to ? 'TO: ' + dayjs(to).format('DD MMM YYYY').toUpperCase() : ''}   |   GENERATED ${dayjs().format('DD MMM YYYY HH:mm').toUpperCase()}   |   ${settlements.length} RECORD(S)`,
    { align: 'center' }
  );
  doc.moveDown(0.8);
  doc.fillColor('#000');

  // Column layout
  const cols = [
    { key: '#', label: '#', width: 26, align: 'left' },
    { key: 'driver', label: 'DRIVER', width: 100, align: 'left' },
    { key: 'car', label: 'CAR', width: 55, align: 'left' },
    { key: 'week', label: 'WEEK', width: 90, align: 'left' },
    { key: 'uber', label: 'UBER', width: 55, align: 'right' },
    { key: 'bolt', label: 'BOLT', width: 55, align: 'right' },
    { key: 'gross', label: 'GROSS', width: 60, align: 'right' },
    { key: 'fleet', label: 'FLEET CHG', width: 62, align: 'right' },
    { key: 'iva', label: 'IVA', width: 50, align: 'right' },
    { key: 'fuel', label: 'FUEL/ELEC', width: 60, align: 'right' },
    { key: 'via', label: 'VIA VERDE', width: 58, align: 'right' },
    { key: 'net', label: 'NET PAID', width: 65, align: 'right' },
    { key: 'status', label: 'STATUS', width: 55, align: 'left' },
  ];
  const tableLeft = doc.page.margins.left;
  const tableWidth = cols.reduce((a, c) => a + c.width, 0);
  const rowHeight = 20;
  const headerColor = '#2b3a55';
  const stripeColor = '#f2f4f8';

  function drawHeaderRow(y) {
    doc.rect(tableLeft, y, tableWidth, rowHeight).fill(headerColor);
    let x = tableLeft;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
    cols.forEach((c) => {
      doc.text(c.label, x + 4, y + 6, { width: c.width - 6, align: c.align });
      x += c.width;
    });
    doc.fillColor('#000');
    return y + rowHeight;
  }

  let y = doc.y;
  y = drawHeaderRow(y);

  let totalGross = 0;
  let totalFleet = 0;
  let totalIva = 0;
  let totalFuel = 0;
  let totalVia = 0;
  let totalNet = 0;

  settlements.forEach((s, i) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawHeaderRow(y);
    }

    const gross = s.uberGross + s.boltGross;
    totalGross += gross;
    totalFleet += s.fleetCharge;
    totalIva += s.ivaWithheld;
    totalFuel += s.fuelElectricCost;
    totalVia += s.viaVerde;
    totalNet += s.netPaid;

    // Zebra stripe
    if (i % 2 === 1) {
      doc.rect(tableLeft, y, tableWidth, rowHeight).fill(stripeColor);
      doc.fillColor('#000');
    }

    const rowVals = {
      '#': String(i + 1),
      driver: s.driver.name.toUpperCase(),
      car: (s.car ? s.car.plate : '-').toUpperCase(),
      week: `${dayjs(s.weekStart).format('DD MMM').toUpperCase()} - ${dayjs(s.weekEnd).format('DD MMM').toUpperCase()}`,
      uber: `€${s.uberGross.toFixed(2)}`,
      bolt: `€${s.boltGross.toFixed(2)}`,
      gross: `€${gross.toFixed(2)}`,
      fleet: `€${s.fleetCharge.toFixed(2)}`,
      iva: `€${s.ivaWithheld.toFixed(2)}`,
      fuel: `€${s.fuelElectricCost.toFixed(2)}`,
      via: `€${s.viaVerde.toFixed(2)}`,
      net: `€${s.netPaid.toFixed(2)}`,
      status: s.status.toUpperCase(),
    };

    let x = tableLeft;
    doc.fontSize(8).font('Helvetica');
    cols.forEach((c) => {
      if (c.key === 'net') doc.font('Helvetica-Bold');
      doc.text(rowVals[c.key], x + 4, y + 6, { width: c.width - 6, align: c.align });
      if (c.key === 'net') doc.font('Helvetica');
      x += c.width;
    });

    y += rowHeight;
  });

  // Bottom border + totals row
  doc.moveTo(tableLeft, y).lineTo(tableLeft + tableWidth, y).strokeColor('#999').stroke();
  y += 3;
  doc.rect(tableLeft, y, tableWidth, rowHeight + 4).fill('#e8ecf3');
  doc.fillColor('#000');
  y += 6;

  doc.fontSize(9).font('Helvetica-Bold');

  const colX = {};
  let runningX = tableLeft;
  cols.forEach((c) => { colX[c.key] = runningX; runningX += c.width; });

  doc.text('TOTALS:', colX['week'], y, { width: cols.find((c) => c.key === 'week').width, align: 'right' });
  doc.text(`€${totalGross.toFixed(2)}`, colX['gross'] + 4, y, { width: cols.find((c) => c.key === 'gross').width - 6, align: 'right' });
  doc.text(`€${totalFleet.toFixed(2)}`, colX['fleet'] + 4, y, { width: cols.find((c) => c.key === 'fleet').width - 6, align: 'right' });
  doc.text(`€${totalIva.toFixed(2)}`, colX['iva'] + 4, y, { width: cols.find((c) => c.key === 'iva').width - 6, align: 'right' });
  doc.text(`€${totalFuel.toFixed(2)}`, colX['fuel'] + 4, y, { width: cols.find((c) => c.key === 'fuel').width - 6, align: 'right' });
  doc.text(`€${totalVia.toFixed(2)}`, colX['via'] + 4, y, { width: cols.find((c) => c.key === 'via').width - 6, align: 'right' });
  doc.text(`€${totalNet.toFixed(2)}`, colX['net'] + 4, y, { width: cols.find((c) => c.key === 'net').width - 6, align: 'right' });

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

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(res);
  buildPayslipPDF(doc, settlement);
  doc.end();
});

// Renders a full-page, styled weekly payslip onto an open PDFDocument.
// Shared design between the admin "Weekly Settlements" PDF button and the driver portal download.
function buildPayslipPDF(doc, settlement) {
  const pageWidth = doc.page.width;
  const marginX = 50;
  const contentWidth = pageWidth - marginX * 2;

  const navy = '#111827';
  const green = '#16a34a';
  const red = '#dc2626';
  const gray = '#6b7280';
  const lightGray = '#f3f4f6';
  const border = '#e5e7eb';

  const gross = settlement.uberGross + settlement.boltGross;
  const deductions =
    settlement.fleetCharge + settlement.ivaWithheld + settlement.fuelElectricCost +
    settlement.viaVerde + settlement.otherDeductions;

  // ---- Header band ----
  doc.rect(0, 0, pageWidth, 110).fill(navy);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('BDCars Fleet', marginX, 34);
  doc.font('Helvetica').fontSize(11).fillColor('#cbd5e1').text('Weekly Payslip', marginX, 60);

  const weekLabel = `${dayjs(settlement.weekStart).format('DD MMM YYYY')}  –  ${dayjs(settlement.weekEnd).format('DD MMM YYYY')}`;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
    .text(weekLabel, marginX, 34, { width: contentWidth, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1')
    .text(`Status: ${settlement.status}`, marginX, 52, { width: contentWidth, align: 'right' });

  // ---- Driver info card ----
  let y = 132;
  doc.roundedRect(marginX, y, contentWidth, 60, 6).fill(lightGray);
  const colWidth = contentWidth / 3;
  const infoCol = (x, label, value) => {
    doc.font('Helvetica').fontSize(8).fillColor(gray).text(label.toUpperCase(), x, y + 14, { width: colWidth - 16 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(navy).text(value, x, y + 28, { width: colWidth - 16 });
  };
  infoCol(marginX + 16, 'Driver', settlement.driver.name);
  infoCol(marginX + 16 + colWidth, 'Vehicle', settlement.car ? settlement.car.plate : '—');
  infoCol(marginX + 16 + colWidth * 2, 'Pay Period', dayjs(settlement.weekEnd).format('DD MMM YYYY'));

  // ---- Earnings breakdown table ----
  y += 90;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(navy).text('EARNINGS', marginX, y);
  y += 20;

  const row = (label, value, opts = {}) => {
    if (opts.zebra) {
      doc.rect(marginX, y - 6, contentWidth, 26).fill(lightGray);
    }
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
      .fillColor(opts.color || navy)
      .text(label, marginX + 12, y, { width: contentWidth * 0.6 });
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5)
      .fillColor(opts.color || navy)
      .text(`${opts.negative ? '-' : ''}€${Number(value).toFixed(2)}`, marginX, y, { width: contentWidth - 12, align: 'right' });
    y += 26;
  };

  row('Uber Earnings', settlement.uberGross, { zebra: true });
  row('Bolt Earnings', settlement.boltGross);
  doc.moveTo(marginX, y - 4).lineTo(marginX + contentWidth, y - 4).strokeColor(border).stroke();
  row('Gross Total', gross, { bold: true });

  y += 14;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(navy).text('DEDUCTIONS', marginX, y);
  y += 20;

  row('Fleet Charge', settlement.fleetCharge, { zebra: true, negative: true, color: red });
  row('IVA Withheld (6%)', settlement.ivaWithheld, { negative: true, color: red });
  row('Fuel / Electric', settlement.fuelElectricCost, { zebra: true, negative: true, color: red });
  row('Via Verde (Tolls)', settlement.viaVerde, { negative: true, color: red });
  row('Other Deductions', settlement.otherDeductions, { zebra: true, negative: true, color: red });
  doc.moveTo(marginX, y - 4).lineTo(marginX + contentWidth, y - 4).strokeColor(border).stroke();
  row('Total Deductions', deductions, { bold: true, negative: true, color: red });

  // ---- Net paid highlight box ----
  y += 20;
  doc.roundedRect(marginX, y, contentWidth, 56, 6).fill(navy);
  doc.font('Helvetica').fontSize(10).fillColor('#cbd5e1').text('NET PAID', marginX + 18, y + 14);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(green)
    .text(`€${settlement.netPaid.toFixed(2)}`, marginX, y + 12, { width: contentWidth - 18, align: 'right' });

  // ---- Footer ----
  const footerY = doc.page.height - 60;
  doc.moveTo(marginX, footerY).lineTo(marginX + contentWidth, footerY).strokeColor(border).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(gray)
    .text(`Generated on ${dayjs().format('DD MMM YYYY, HH:mm')} · BDCars Fleet`, marginX, footerY + 10, {
      width: contentWidth,
      align: 'center',
    });
}

module.exports = router;