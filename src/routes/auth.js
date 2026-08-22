const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

// LOGIN FORM
router.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

// LOGIN SUBMIT
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const validUsername = username === process.env.ADMIN_USERNAME;
  const validPassword =
    validUsername &&
    process.env.ADMIN_PASSWORD_HASH &&
    (await bcrypt.compare(password || '', process.env.ADMIN_PASSWORD_HASH));

  if (!validUsername || !validPassword) {
    return res.render('login', { error: 'Invalid username or password.' });
  }

  req.session.loggedIn = true;
  req.session.username = username;
  res.redirect('/');
});

// LOGOUT
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;