const express = require('express');
const router = express.Router();
const prisma = require('../db');

// LIST + ADD FORM
router.get('/', async (req, res) => {
  const [cars, drivers, owners] = await Promise.all([
    prisma.car.findMany({ include: { currentDriver: true, owner: true }, orderBy: { plate: 'asc' } }),
    prisma.driver.findMany({ where: { status: 'ACTIVE' } }),
    prisma.carOwner.findMany(),
  ]);
  res.render('cars/index', { cars, drivers, owners, error: null });
});

// CREATE
router.post('/', async (req, res) => {
  const { plate, make, model, fuelType, weeklyRentalCost, ownerId } = req.body;
  try {
    await prisma.car.create({
      data: {
        plate,
        make,
        model,
        fuelType,
        weeklyRentalCost: Number(weeklyRentalCost || 0),
        ownerId: ownerId || null,
      },
    });
    res.redirect('/cars');
  } catch (err) {
    const [cars, drivers, owners] = await Promise.all([
      prisma.car.findMany({ include: { currentDriver: true, owner: true } }),
      prisma.driver.findMany({ where: { status: 'ACTIVE' } }),
      prisma.carOwner.findMany(),
    ]);
    res.render('cars/index', { cars, drivers, owners, error: 'Could not add car. Check the plate is not already used.' });
  }
});

// EDIT FORM
router.get('/:id/edit', async (req, res) => {
  const [car, owners] = await Promise.all([
    prisma.car.findUnique({ where: { id: req.params.id } }),
    prisma.carOwner.findMany(),
  ]);
  if (!car) return res.redirect('/cars');
  res.render('cars/edit', { car, owners });
});

// UPDATE
router.put('/:id', async (req, res) => {
  const { plate, make, model, fuelType, weeklyRentalCost, status, ownerId } = req.body;
  await prisma.car.update({
    where: { id: req.params.id },
    data: {
      plate,
      make,
      model,
      fuelType,
      weeklyRentalCost: Number(weeklyRentalCost || 0),
      status,
      ownerId: ownerId || null,
    },
  });
  res.redirect('/cars');
});

// ASSIGN DRIVER (closes any previous assignment, opens a new one)
router.post('/:id/assign', async (req, res) => {
  const carId = req.params.id;
  const { driverId } = req.body;

  const car = await prisma.car.findUnique({ where: { id: carId } });

  // Close current open assignment for this car, if any
  await prisma.assignmentHistory.updateMany({
    where: { carId, endDate: null },
    data: { endDate: new Date() },
  });

  await prisma.car.update({
    where: { id: carId },
    data: { currentDriverId: driverId || null },
  });

  if (driverId) {
    await prisma.assignmentHistory.create({
      data: { carId, driverId },
    });
  }

  res.redirect('/cars');
});

// DELETE (or retire if it has history)
router.delete('/:id', async (req, res) => {
  const settlementCount = await prisma.weeklySettlement.count({ where: { carId: req.params.id } });
  if (settlementCount > 0) {
    await prisma.car.update({ where: { id: req.params.id }, data: { status: 'RETIRED', currentDriverId: null } });
  } else {
    await prisma.assignmentHistory.deleteMany({ where: { carId: req.params.id } });
    await prisma.insurance.deleteMany({ where: { carId: req.params.id } });
    await prisma.maintenanceLog.deleteMany({ where: { carId: req.params.id } });
    await prisma.car.delete({ where: { id: req.params.id } });
  }
  res.redirect('/cars');
});

module.exports = router;
