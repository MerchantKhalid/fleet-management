// Blocks access to a portal route unless a driver is logged in via /portal/login.
// Completely separate session flag from the admin's req.session.loggedIn,
// so an admin session and a driver session never get mixed up.
function requireDriverAuth(req, res, next) {
  if (req.session && req.session.driverId) {
    return next();
  }
  return res.redirect('/portal/login');
}

module.exports = { requireDriverAuth };
