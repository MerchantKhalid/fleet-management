const express = require('express');
const router = express.Router();
const prisma = require('../db');
const dayjs = require('dayjs');

router.get('/', async (req, res) => {
  const in30Days = dayjs().add(30, 'day').toDate();
  const now = new Date();

  const [activeDrivers, activeCars, recentSettlements] = await Promise.all([
    prisma.driver.count({ where: { status: 'ACTIVE' } }),
    prisma.car.count({ where: { status: 'ACTIVE' } }),
    prisma.weeklySettlement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { driver: true, car: true },
    }),
  ]);

  const weekTotal = recentSettlements.reduce((sum, s) => sum + s.netPaid, 0);

  const [expiringLicenses, expiringLicenses2, expiringInsurance, dueMaintenance] = await Promise.all([
    prisma.driver.findMany({ where: { tvdeExpiry: { lte: in30Days, gte: now } } }),
    prisma.driver.findMany({ where: { drivingLicenseExpiry: { lte: in30Days, gte: now } } }),
    prisma.insurance.findMany({ where: { expiryDate: { lte: in30Days, gte: now } }, include: { car: true } }),
    prisma.maintenanceLog.findMany({ where: { nextServiceDue: { lte: in30Days, gte: now } }, include: { car: true } }),
  ]);

  const alerts = [
    ...expiringLicenses.map((d) => `TVDE license for ${d.name} expires ${dayjs(d.tvdeExpiry).format('DD MMM YYYY')}`),
    ...expiringLicenses2.map((d) => `Driving license for ${d.name} expires ${dayjs(d.drivingLicenseExpiry).format('DD MMM YYYY')}`),
    ...expiringInsurance.map((i) => `Insurance on ${i.car.plate} expires ${dayjs(i.expiryDate).format('DD MMM YYYY')}`),
    ...dueMaintenance.map((m) => `Service due on ${m.car.plate} by ${dayjs(m.nextServiceDue).format('DD MMM YYYY')}`),
  ];

  res.render('dashboard', {
    activeDrivers,
    activeCars,
    weekTotal,
    alerts,
    recentSettlements,
  });
});

module.exports = router;
