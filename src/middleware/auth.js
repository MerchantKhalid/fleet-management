// Blocks access to a route unless the user is logged in.
// Any route mounted after this middleware in app.js will redirect to /login if not authenticated.
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.redirect('/login');
}

module.exports = { requireAuth };