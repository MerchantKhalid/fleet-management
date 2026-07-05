require('dotenv').config();
const express = require('express');
const path = require('path');
const methodOverride = require('method-override');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/dashboard'));
app.use('/drivers', require('./routes/drivers'));
app.use('/cars', require('./routes/cars'));
app.use('/settlements', require('./routes/settlements'));
app.use('/iva-refunds', require('./routes/ivaRefunds'));
app.use('/insurance', require('./routes/insurance'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/export', require('./routes/exportRoutes'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TVDE Fleet Manager running at http://localhost:${PORT}`);
});
