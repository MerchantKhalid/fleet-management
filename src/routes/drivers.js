const express = require('express');
const router = express.Router();
const prisma = require('../db');

// LIST
router.get('/', async (req, res) => {
  const drivers = await prisma.driver.findMany({
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });
  res.render('drivers/index', { drivers, error: null });
});

// ADD FORM (its own page)
router.get('/new', (req, res) => {
  res.render('drivers/new', { error: null });
});

// CREATE
router.post('/', async (req, res) => {
  const {
    name, phone, email, iban, carOwnership,
    carMake, carModel, carPlate, carFuelType, carWeeklyRentalCost, carOwnerName,
  } = req.body;
  try {
    const driver = await prisma.driver.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        iban: iban || null,
        carOwnership: carOwnership || null,
      },
    });

    // Optional: create & assign a car for this driver in the same step
    if (carPlate) {
      let ownerId = null;
      if (carOwnerName) {
        const existingOwner = await prisma.carOwner.findFirst({ where: { name: carOwnerName } });
        const owner = existingOwner || (await prisma.carOwner.create({ data: { name: carOwnerName } }));
        ownerId = owner.id;
      }

      const car = await prisma.car.create({
        data: {
          plate: carPlate,
          make: carMake || '',
          model: carModel || '',
          fuelType: carFuelType || 'PETROL',
          weeklyRentalCost: Number(carWeeklyRentalCost || 0),
          ownerId,
          currentDriverId: driver.id,
        },
      });

      await prisma.assignmentHistory.create({ data: { carId: car.id, driverId: driver.id } });
    }

    // After adding, go to the drivers list (a different page than the add form)
    res.redirect('/drivers');
  } catch (err) {
    res.render('drivers/new', { error: 'Could not add driver. Check the car plate is not already used.' });
  }
});

// DETAIL (shows IBAN, email, etc.)
router.get('/:id', async (req, res) => {
  const driver = await prisma.driver.findUnique({
    where: { id: req.params.id },
    include: { currentCar: true },
  });
  if (!driver) return res.redirect('/drivers');
  res.render('drivers/show', { driver });
});

// EDIT FORM
router.get('/:id/edit', async (req, res) => {
  const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!driver) return res.redirect('/drivers');
  res.render('drivers/edit', { driver });
});

// UPDATE
router.put('/:id', async (req, res) => {
  const { name, phone, email, iban, carOwnership, status } = req.body;
  await prisma.driver.update({
    where: { id: req.params.id },
    data: {
      name,
      phone: phone || null,
      email: email || null,
      iban: iban || null,
      carOwnership: carOwnership || null,
      status,
    },
  });
  res.redirect('/drivers/' + req.params.id);
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
