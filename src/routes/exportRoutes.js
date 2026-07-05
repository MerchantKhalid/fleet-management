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
