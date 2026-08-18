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

// UBER DECLARATION (form + live preview + print-to-PDF)
router.get('/uber-declaration', async (req, res) => {
  const drivers = await prisma.driver.findMany({
    where: { status: 'ACTIVE' },
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });
  res.render('contracts/uber-declaration', { drivers });
});

// BOLT DECLARATION / COMODATO (form + live preview + print-to-PDF)
router.get('/bolt-declaration', async (req, res) => {
  const drivers = await prisma.driver.findMany({
    where: { status: 'ACTIVE' },
    include: { currentCar: true },
    orderBy: { name: 'asc' },
  });
  res.render('contracts/bolt-declaration', { drivers });
});

module.exports = router;
