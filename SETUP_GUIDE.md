# Setup Guide — TVDE Fleet Manager

This is a real, working Node.js + Express + Prisma app. Everything is already written — you just need to install dependencies and start the database. Follow these steps in order.

## 0. Requirements
- Node.js installed (v18 or newer). Check with:
```
node -v
```
If that fails, install Node.js from nodejs.org first.

## 1. Unzip the project
Unzip `tvde-fleet-manager.zip` anywhere on your computer, then open a terminal in that folder:
```
cd tvde-fleet-manager
```

## 2. Install dependencies
```
npm install
```
This reads `package.json` and installs Express, Prisma, EJS, PDFKit, etc.

## 3. Set up your environment file
```
cp .env.example .env
```
The default `.env` already points to a local SQLite file (`dev.db`) — no database server needed to get started. Leave it as is for now.

## 4. Create the database and tables
```
npx prisma migrate dev --name init
```
This reads `prisma/schema.prisma` and creates `dev.db` with all the tables (Driver, Car, WeeklySettlement, etc.).

## 5. Load sample data (optional but recommended first time)
```
npm run seed
```
This adds 2 sample drivers, 2 cars, an assignment, and one insurance policy so the app isn't empty when you first open it.

## 6. Start the app
```
npm start
```
You should see:
```
TVDE Fleet Manager running at http://localhost:3000
```
Open that URL in your browser.

## 7. What you can do right away
- **Drivers** — add a new driver, edit one, delete one
- **Cars** — add a new car, assign/unassign a driver to it (dropdown, updates instantly)
- **Weekly Settlement** — pick a driver, enter Uber/Bolt earnings + charges, save — net payout is calculated automatically
- **IVA Refunds** — mark a driver's withheld IVA as refunded once they send you the green receipt
- **Insurance** — add a policy, set billing period (monthly/3/6/12 months) and who pays
- **Maintenance** — log repairs/services per car
- **Export Records** — download a CSV of settlements, or a PDF payslip for any driver's week

## 8. Making changes during development
Instead of `npm start`, use:
```
npm run dev
```
This restarts the server automatically whenever you edit a file.

If you change `prisma/schema.prisma` (add a field, a table, etc.), run:
```
npx prisma migrate dev --name describe_your_change
```
every time, to apply the change to the database.

## 9. Inspecting your data visually
Prisma has a built-in database viewer:
```
npx prisma studio
```
Opens a browser tab where you can see and edit every table directly — useful for checking things or fixing a mistake without writing code.

## 10. Moving to Postgres later (optional, for production)
Right now it uses SQLite (a single file, zero setup). When you're ready to run this on a real server:
1. Install PostgreSQL (or use a hosted one, e.g. Supabase, Railway, Neon)
2. In `prisma/schema.prisma`, change:
   ```
   provider = "sqlite"
   ```
   to:
   ```
   provider = "postgresql"
   ```
3. Update `DATABASE_URL` in `.env` to your Postgres connection string
4. Run `npx prisma migrate dev` again
5. (Recommended) change the `Float` fields in the schema to `Decimal @db.Decimal(10,2)` for exact money math — Postgres supports this, SQLite doesn't

## Troubleshooting
- **"Cannot find module..."** → you skipped `npm install`, run it.
- **"Table does not exist"** → you skipped `npx prisma migrate dev`, run it.
- **Port 3000 already in use** → change `PORT=3000` to `PORT=3001` in `.env`.
- **Deleted something by accident** → run `npx prisma studio` to view/restore data directly, or re-run `npm run seed` to reset sample data (only safe on a fresh/empty database).

## Project structure
```
tvde-fleet-manager/
├── package.json
├── .env.example
├── prisma/
│   ├── schema.prisma       ← all database tables defined here
│   └── seed.js             ← sample data
└── src/
    ├── app.js              ← server entry point, wires up all routes
    ├── db.js               ← shared Prisma client
    ├── services/
    │   └── settlementService.js   ← the payout calculation logic
    ├── routes/
    │   ├── dashboard.js
    │   ├── drivers.js
    │   ├── cars.js
    │   ├── settlements.js
    │   ├── ivaRefunds.js
    │   ├── insurance.js
    │   ├── maintenance.js
    │   └── exportRoutes.js
    ├── views/              ← all pages (EJS templates)
    └── public/css/style.css
```
