const { constantTimeEqual, createAdminToken } = require('../lib/admin-auth');

module.exports = async function adminLogin(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const adminUsername = process.env.ADMIN_USERNAME || 'kapiaadmin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'h1zqp7ld269o';

  const username = typeof request.body?.username === 'string' ? request.body.username : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (!constantTimeEqual(username, adminUsername) || !constantTimeEqual(password, adminPassword)) {
    return response.status(401).json({ error: 'Invalid username or password.' });
  }

  return response.status(200).json({ token: createAdminToken(adminPassword) });
};
