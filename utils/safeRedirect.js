module.exports = value => typeof value === 'string' && /^\/(?![\/\\])/.test(value) && !/[\\\r\n]/.test(value) ? value : '/listings';
