const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const PDFDocument = require('pdfkit');
const prisma = require('../db');
const { requireDriverAuth } = require('../middleware/driverAuth');

const PAGE_SIZE = 10;

// LOGIN FORM (public)
router.get('/login', (req, res) => {
  if (req.session && req.session.driverId) {
    return res.redirect('/portal');
  }
  res.render('portal/login', { error: null });
});

// LOGIN SUBMIT (public) — driver signs in with their email + the password the admin set for them
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const driver = email
    ? await prisma.driver.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
    : null;

  const validPassword =
    driver &&
    driver.portalPasswordHash &&
    (await bcrypt.compare(password || '', driver.portalPasswordHash));

  if (!driver || !validPassword) {
    return res.render('portal/login', { error: 'Invalid email or password.' });
  }

  req.session.driverId = driver.id;
  res.redirect('/portal');
});

// LOGOUT
router.post('/logout', (req, res) => {
  req.session.driverId = null;
  res.redirect('/portal/login');
});

// Everything below this line requires a logged-in driver
router.use(requireDriverAuth);

// DASHBOARD — own settlements (paginated), own IVA refund status, own upcoming document expirations
router.get('/', async (req, res) => {
  const driverId = req.session.driverId;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [driver, settlements, totalCount, ivaRefunds] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, include: { currentCar: true } }),
    prisma.weeklySettlement.findMany({
      where: { driverId },
      include: { car: true },
      orderBy: { weekStart: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.weeklySettlement.count({ where: { driverId } }),
    prisma.ivaRefund.findMany({ where: { driverId }, orderBy: { periodStart: 'desc' } }),
  ]);

  if (!driver) {
    req.session.driverId = null;
    return res.redirect('/portal/login');
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const ivaWithheldTotal = ivaRefunds
    .filter((r) => r.status === 'WITHHELD')
    .reduce((sum, r) => sum + r.amount, 0);
  const ivaRefundedTotal = ivaRefunds
    .filter((r) => r.status === 'REFUNDED')
    .reduce((sum, r) => sum + r.amount, 0);

  const in30Days = dayjs().add(30, 'day').toDate();
  const now = new Date();
  const expiryAlerts = [];
  if (driver.licenseExpiryDate && driver.licenseExpiryDate >= now && driver.licenseExpiryDate <= in30Days) {
    expiryAlerts.push(`Your driving license expires ${dayjs(driver.licenseExpiryDate).format('DD MMM YYYY')}`);
  }
  if (driver.tvdeCertExpiryDate && driver.tvdeCertExpiryDate >= now && driver.tvdeCertExpiryDate <= in30Days) {
    expiryAlerts.push(`Your TVDE certificate expires ${dayjs(driver.tvdeCertExpiryDate).format('DD MMM YYYY')}`);
  }
  if (driver.currentCar && driver.currentCar.nextInspectionDate && driver.currentCar.nextInspectionDate >= now && driver.currentCar.nextInspectionDate <= in30Days) {
    expiryAlerts.push(`Your car (${driver.currentCar.plate}) is due for inspection ${dayjs(driver.currentCar.nextInspectionDate).format('DD MMM YYYY')}`);
  }

  res.render('portal/dashboard', {
    driver,
    settlements,
    page,
    totalPages,
    totalCount,
    ivaWithheldTotal,
    ivaRefundedTotal,
    expiryAlerts,
  });
});

// PAYSLIP DOWNLOAD — only for the logged-in driver's own settlement
router.get('/settlements/:id/payslip', async (req, res) => {
  const settlement = await prisma.weeklySettlement.findUnique({
    where: { id: req.params.id },
    include: { driver: true, car: true },
  });

  if (!settlement || settlement.driverId !== req.session.driverId) {
    return res.status(404).send('Payslip not found');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip_${dayjs(settlement.weekStart).format('YYYY-MM-DD')}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).text('Weekly Payslip', { align: 'center' });
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Driver: ${settlement.driver.name}`);
  doc.text(`Car: ${settlement.car ? settlement.car.plate : '-'}`);
  doc.text(`Week: ${dayjs(settlement.weekStart).format('DD MMM YYYY')} - ${dayjs(settlement.weekEnd).format('DD MMM YYYY')}`);
  doc.moveDown();

  const line = (label, value) => doc.text(`${label}: €${Number(value).toFixed(2)}`);

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
  doc.fontSize(13).text(`Net Paid: €${settlement.netPaid.toFixed(2)}`, { underline: true });

  doc.end();
});

module.exports = router;
