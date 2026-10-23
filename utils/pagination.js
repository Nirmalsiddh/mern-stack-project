const ExpressError = require('./ExpressError');
const PAGE_SIZE = 12;
function pageNumber(value) {
    if (value === undefined) return 1;
    if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) {
        throw new ExpressError(400, 'Page must be a positive integer of at most six digits.');
    }
    return Number(value);
}
function pageInfo(total, requested, path, params = {}, size = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(requested, pages);
    const url = number => `${path}?${new URLSearchParams({ ...params, page: String(number) })}`;
    return { total, page, pages, size, skip: (page - 1) * size, previous: page > 1 ? url(page - 1) : null, next: page < pages ? url(page + 1) : null };
}
module.exports = { PAGE_SIZE, pageNumber, pageInfo };
