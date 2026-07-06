const express = require('express');
const router = express.Router();
const prisma = require('../db');

// LIST + ADD FORM
router.get('/', async (req, res) => {
  const [accidents, cars, drivers] = await Promise.all([
    prisma.accidentHistory.findMany({
      include: { car: true, driver: true },
      orderBy: { date: 'desc' },
    }),
    prisma.car.findMany({ orderBy: { plate: 'asc' } }),
    prisma.driver.findMany({ orderBy: { name: 'asc' } }),
  ]);
  res.render('accidents/index', { accidents, cars, drivers, error: null });
});

// CREATE
router.post('/', async (req, res) => {
  const {
    carId, driverId, date, place, driverNumber, opponentDriverNumber, opponentCarPlate, notes,
  } = req.body;
  try {
    await prisma.accidentHistory.create({
      data: {
        carId,
        driverId: driverId || null,
        date: new Date(date),
        place: place || null,
        driverNumber: driverNumber || null,
        opponentDriverNumber: opponentDriverNumber || null,
        opponentCarPlate: opponentCarPlate || null,
        notes: notes || null,
      },
    });
    res.redirect('/accidents');
  } catch (err) {
    const [accidents, cars, drivers] = await Promise.all([
      prisma.accidentHistory.findMany({ include: { car: true, driver: true }, orderBy: { date: 'desc' } }),
      prisma.car.findMany({ orderBy: { plate: 'asc' } }),
      prisma.driver.findMany({ orderBy: { name: 'asc' } }),
    ]);
    res.render('accidents/index', { accidents, cars, drivers, error: 'Could not save accident record. Please check the fields and try again.' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  await prisma.accidentHistory.delete({ where: { id: req.params.id } });
  res.redirect('/accidents');
});

module.exports = router;
