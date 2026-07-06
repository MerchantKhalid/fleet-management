const prisma = require('../db');
const dayjs = require('dayjs');

const IVA_RATE = 0.06;

// Pure calculation — no DB access. Used both by the form preview and on save.
function calculate({ uberGross, boltGross, fleetCharge, fuelElectricCost, viaVerde, otherDeductions }) {
  const gross = Number(uberGross || 0) + Number(boltGross || 0);
  const ivaWithheld = round2(gross * IVA_RATE);
  const netPaid = round2(
    gross -
      Number(fleetCharge || 0) -
      ivaWithheld -
      Number(fuelElectricCost || 0) -
      Number(viaVerde || 0) -
      Number(otherDeductions || 0)
  );
  return { gross: round2(gross), ivaWithheld, netPaid };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Creates the settlement AND the linked IVA refund record in one transaction.
async function createSettlement(input) {
  const { gross, ivaWithheld, netPaid } = calculate(input);

  const settlement = await prisma.weeklySettlement.create({
    data: {
      driverId: input.driverId,
      carId: input.carId || null,
      weekStart: new Date(input.weekStart),
      weekEnd: new Date(input.weekEnd),
      uberGross: Number(input.uberGross || 0),
      boltGross: Number(input.boltGross || 0),
      fleetCharge: Number(input.fleetCharge || 0),
      ivaWithheld,
      fuelElectricCost: Number(input.fuelElectricCost || 0),
      viaVerde: Number(input.viaVerde || 0),
      otherDeductions: Number(input.otherDeductions || 0),
      netPaid,
      status: 'PENDING',
    },
  });

  const period = dayjs(input.weekStart).format('YYYY-MM');

  await prisma.ivaRefund.create({
    data: {
      driverId: input.driverId,
      period,
      periodStart: new Date(input.weekStart),
      periodEnd: new Date(input.weekEnd),
      amount: ivaWithheld,
      status: 'WITHHELD',
    },
  });

  return settlement;
}

module.exports = { calculate, createSettlement, IVA_RATE };
