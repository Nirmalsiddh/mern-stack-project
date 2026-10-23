const ExpressError = require('./ExpressError');
const { normalizeCategory } = require('./categories');
const { pageNumber } = require('./pagination');
const sortOptions = [
    { value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' },
    { value: 'price-asc', label: 'Price: Low to High' }, { value: 'price-desc', label: 'Price: High to Low' },
];
const sorts = { newest: { _id: -1 }, oldest: { _id: 1 }, 'price-asc': { price: 1, _id: 1 }, 'price-desc': { price: -1, _id: -1 } };
function discovery(query) {
    const category = query.filter === undefined ? 'all' : normalizeCategory(query.filter);
    if (!category) throw new ExpressError(400, 'Invalid listing category.');
    if (query.country !== undefined && (typeof query.country !== 'string' || query.country.length > 100)) throw new ExpressError(400, 'Search must be text of at most 100 characters.');
    const country = query.country?.trim() || '';
    const sort = query.sort === undefined ? 'newest' : query.sort;
    if (typeof sort !== 'string' || !Object.hasOwn(sorts, sort)) throw new ExpressError(400, 'Invalid sort order.');
    const size = query.pageSize === undefined ? '12' : query.pageSize;
    if ((typeof size !== 'string' || !/^(?:[1-9]|1\d|2[0-4])$/.test(size))) throw new ExpressError(400, 'Page size must be between 1 and 24.');
    const params = { ...(category !== 'all' ? { filter: category } : {}), ...(country ? { country } : {}), ...(sort !== 'newest' ? { sort } : {}), ...(query.pageSize !== undefined ? { pageSize: String(size) } : {}) };
    const filter = category === 'all' ? {} : { filters: { $in: [...new Set([category, category.replace(/ /g, '-')])] } };
    if (country) filter.country = new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return { category, country, sort, size: Number(size), page: pageNumber(query.page), params, filter, order: sorts[sort] };
}
module.exports = { discovery, sortOptions };
