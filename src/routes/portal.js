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

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(res);
  buildPayslipPDF(doc, settlement);
  doc.end();
});

// Renders a full-page, styled weekly payslip onto an open PDFDocument.
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
    .text(`Generated on ${dayjs().format('DD MMM YYYY, HH:mm')} · BDCars Fleet Driver Portal`, marginX, footerY + 10, {
      width: contentWidth,
      align: 'center',
    });
}

module.exports = router;
