const express = require('express');
const router = express.Router();
const prisma = require('../db');

router.get('/', async (req, res) => {
  const [logs, cars] = await Promise.all([
    prisma.maintenanceLog.findMany({ include: { car: true }, orderBy: { date: 'desc' } }),
    prisma.car.findMany({ where: { status: { not: 'RETIRED' } } }),
  ]);
  res.render('maintenance/index', { logs, cars });
});

router.post('/', async (req, res) => {
  const { carId, date, description, cost, garage, nextServiceDue } = req.body;
  await prisma.maintenanceLog.create({
    data: {
      carId,
      date: date ? new Date(date) : new Date(),
      description,
      cost: Number(cost || 0),
      garage: garage || null,
      nextServiceDue: nextServiceDue ? new Date(nextServiceDue) : null,
    },
  });
  res.redirect('/maintenance');
});

router.delete('/:id', async (req, res) => {
  await prisma.maintenanceLog.delete({ where: { id: req.params.id } });
  res.redirect('/maintenance');
});

module.exports = router;
