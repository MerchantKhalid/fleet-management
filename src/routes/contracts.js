const express = require('express');
const router = express.Router();
const prisma = require('../db');

// GENERATE CONTRACT (form + live preview + print-to-PDF)
router.get('/', async (req, res) => {
  const drivers = await prisma.driver.findMany({
    where: { status: 'ACTIVE' },
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });
  res.render('contracts/new', { drivers });
});

module.exports = router;
