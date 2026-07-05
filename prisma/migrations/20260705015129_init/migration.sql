-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "nif" TEXT,
    "tvdeLicenseNumber" TEXT,
    "tvdeExpiry" DATETIME,
    "drivingLicenseExpiry" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CarOwner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nif" TEXT,
    "phone" TEXT
);

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plate" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "fuelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "weeklyRentalCost" REAL NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "currentDriverId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Car_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "CarOwner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Car_currentDriverId_fkey" FOREIGN KEY ("currentDriverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    CONSTRAINT "AssignmentHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentHistory_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklySettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "carId" TEXT,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    "uberGross" REAL NOT NULL DEFAULT 0,
    "boltGross" REAL NOT NULL DEFAULT 0,
    "fleetCharge" REAL NOT NULL DEFAULT 0,
    "ivaWithheld" REAL NOT NULL DEFAULT 0,
    "fuelElectricCost" REAL NOT NULL DEFAULT 0,
    "viaVerde" REAL NOT NULL DEFAULT 0,
    "otherDeductions" REAL NOT NULL DEFAULT 0,
    "netPaid" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklySettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WeeklySettlement_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IvaRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "receiptRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WITHHELD',
    "refundedAt" DATETIME,
    CONSTRAINT "IvaRefund_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "policyNumber" TEXT,
    "cost" REAL NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "paidBy" TEXT NOT NULL DEFAULT 'COMPANY',
    "expiryDate" DATETIME NOT NULL,
    CONSTRAINT "Insurance_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "cost" REAL NOT NULL,
    "garage" TEXT,
    "nextServiceDue" DATETIME,
    CONSTRAINT "MaintenanceLog_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Driver_nif_key" ON "Driver"("nif");

-- CreateIndex
CREATE UNIQUE INDEX "Car_plate_key" ON "Car"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "Car_currentDriverId_key" ON "Car"("currentDriverId");
