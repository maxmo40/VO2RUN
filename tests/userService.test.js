const assert = require('node:assert');
const { normalizeEmail, validateUserInput } = require('../userService');

assert.strictEqual(normalizeEmail('Demo@VO2RUN.fr'), 'demo@vo2run.fr');
assert.throws(() => validateUserInput({ name: '', email: 'demo@vo2run.fr', password: 'abc123' }), /Nom/);
assert.throws(() => validateUserInput({ name: 'Demo', email: '', password: 'abc123' }), /Email/);
assert.throws(() => validateUserInput({ name: 'Demo', email: 'demo@vo2run.fr', password: '123' }), /Mot de passe/);

console.log('userService validation tests passed');
