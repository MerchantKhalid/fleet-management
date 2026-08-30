require('dotenv').config();
const express = require('express');
const path = require('path');
const methodOverride = require('method-override');
const session = require('express-session');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));

// Public routes (no login required)
app.use('/', require('./routes/auth'));

app.use('/portal', require('./routes/portal'));

// Everything below this line requires login
app.use(requireAuth);

app.use('/', require('./routes/dashboard'));
app.use('/drivers', require('./routes/drivers'));
app.use('/cars', require('./routes/cars'));
app.use('/settlements', require('./routes/settlements'));
app.use('/iva-refunds', require('./routes/ivaRefunds'));
app.use('/insurance', require('./routes/insurance'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/accidents', require('./routes/accidents'));
app.use('/expenses', require('./routes/expenses'));
app.use('/custom-payments', require('./routes/customPayments'));
app.use('/export', require('./routes/exportRoutes'));
app.use('/contracts', require('./routes/contracts'));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`TVDE Fleet Manager running at http://localhost:${PORT}`);
});