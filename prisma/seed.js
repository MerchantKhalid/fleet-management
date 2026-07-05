const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const driver1 = await prisma.driver.create({
    data: {
      name: 'João Ribeiro',
      phone: '912345678',
      nif: '231445902',
      tvdeLicenseNumber: 'TVDE-0001',
      tvdeExpiry: new Date('2026-11-14'),
      drivingLicenseExpiry: new Date('2028-03-03'),
      status: 'ACTIVE',
    },
  });

  const driver2 = await prisma.driver.create({
    data: {
      name: 'Sofia Matias',
      phone: '913456789',
      nif: '198774220',
      tvdeLicenseNumber: 'TVDE-0002',
      tvdeExpiry: new Date('2026-09-02'),
      drivingLicenseExpiry: new Date('2026-08-03'),
      status: 'ACTIVE',
    },
  });

  const car1 = await prisma.car.create({
    data: {
      plate: '22-FT-31',
      make: 'Toyota',
      model: 'Corolla Hybrid',
      fuelType: 'HYBRID',
      weeklyRentalCost: 180,
      currentDriverId: driver1.id,
    },
  });

  await prisma.car.create({
    data: {
      plate: '18-QA-02',
      make: 'Skoda',
      model: 'Octavia',
      fuelType: 'DIESEL',
      weeklyRentalCost: 165,
      currentDriverId: driver2.id,
    },
  });

  await prisma.assignmentHistory.create({
    data: { driverId: driver1.id, carId: car1.id },
  });

  await prisma.insurance.create({
    data: {
      carId: car1.id,
      insurer: 'Fidelidade',
      policyNumber: 'PT-99213-A',
      cost: 64,
      billingPeriod: 'MONTHLY',
      paidBy: 'COMPANY',
      expiryDate: new Date('2026-07-17'),
    },
  });

  console.log('Seed data created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
