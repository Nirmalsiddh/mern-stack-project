const { randomBytes } = require('node:crypto');

// Use the existing plugin's password implementation and parameters for both
// paths. The unsaved dummy is prepared once, before production startup listens.
async function createAuthenticate(User) {
    const dummy = new User();
    await dummy.setPassword(randomBytes(48).toString('hex'));
    return (username, password, done) => {
        Promise.resolve().then(() => User.findByUsername(username, true)).then(async user => {
            if (user) return user.authenticate(password);
            await dummy.authenticate(password);
            return { user: false, error: { message: 'Invalid username or password.' } };
        }).then(({ user, error }) => done(null, user, error), done);
    };
}
module.exports = { createAuthenticate };
