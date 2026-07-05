const express = require('express');
const router = express.Router();
const prisma = require('../db');

// LIST + ADD FORM
router.get('/', async (req, res) => {
  const drivers = await prisma.driver.findMany({
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });
  res.render('drivers/index', { drivers, error: null });
});

// CREATE
router.post('/', async (req, res) => {
  const { name, phone, nif, tvdeLicenseNumber, tvdeExpiry, drivingLicenseExpiry } = req.body;
  try {
    await prisma.driver.create({
      data: {
        name,
        phone: phone || null,
        nif: nif || null,
        tvdeLicenseNumber: tvdeLicenseNumber || null,
        tvdeExpiry: tvdeExpiry ? new Date(tvdeExpiry) : null,
        drivingLicenseExpiry: drivingLicenseExpiry ? new Date(drivingLicenseExpiry) : null,
      },
    });
    res.redirect('/drivers');
  } catch (err) {
    const drivers = await prisma.driver.findMany({ include: { currentCar: true } });
    res.render('drivers/index', { drivers, error: 'Could not add driver. Check the NIF is not already used.' });
  }
});

// EDIT FORM
router.get('/:id/edit', async (req, res) => {
  const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!driver) return res.redirect('/drivers');
  res.render('drivers/edit', { driver });
});

// UPDATE
router.put('/:id', async (req, res) => {
  const { name, phone, nif, tvdeLicenseNumber, tvdeExpiry, drivingLicenseExpiry, status } = req.body;
  await prisma.driver.update({
    where: { id: req.params.id },
    data: {
      name,
      phone: phone || null,
      nif: nif || null,
      tvdeLicenseNumber: tvdeLicenseNumber || null,
      tvdeExpiry: tvdeExpiry ? new Date(tvdeExpiry) : null,
      drivingLicenseExpiry: drivingLicenseExpiry ? new Date(drivingLicenseExpiry) : null,
      status,
    },
  });
  res.redirect('/drivers');
});

// DELETE (or deactivate if it has history)
router.delete('/:id', async (req, res) => {
  const settlementCount = await prisma.weeklySettlement.count({ where: { driverId: req.params.id } });
  if (settlementCount > 0) {
    await prisma.driver.update({ where: { id: req.params.id }, data: { status: 'INACTIVE' } });
  } else {
    await prisma.assignmentHistory.deleteMany({ where: { driverId: req.params.id } });
    await prisma.driver.delete({ where: { id: req.params.id } });
  }
  res.redirect('/drivers');
});

module.exports = router;
