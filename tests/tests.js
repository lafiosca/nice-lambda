'use strict';

const {
	lambda,
	api,
	apiMethods,
	apiMethodsWithOptions,
} = require('../dist/index');
const Boom = require('@hapi/boom');

const apiOptions = {
	headers: {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type,Authorization',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	},
};

const apiOptionsWithoutGet = {
	headers: {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type,Authorization',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
	},
};

module.exports.promiseSucceed = lambda(
	() => Promise.resolve('foobar'),
);

module.exports.promiseFail = lambda(
	() => {
		throw new Error('fail');
	},
);

module.exports.promiseFail2 = lambda(
	() => Promise.resolve('foobar')
		.then(() => {
			throw new Error('also fail');
		}),
);

module.exports.apiSucceed = api(
	() => Promise.resolve('foobar'),
);

module.exports.apiSucceed2 = api(
	() => Promise.resolve({ data: { name: 'foobar', value: 3 } }),
);

module.exports.apiSucceed3 = api(
	() => Promise.resolve({ statusCode: 302, body: 'redirect' }),
);

module.exports.apiSucceed3 = api(
	() => Promise.resolve({
		statusCode: 419,
		body: {
			message: 'foo bar',
		},
		headers: {
			'X-Other': 'blah',
		},
	}),
);

module.exports.apiFail = api(
	() => {
		throw new Error('fail');
	},
);

module.exports.apiFail2 = api(
	() => Promise.resolve('foobar')
		.then(() => {
			throw new Error('also fail');
		}),
);

module.exports.apiFail3 = api(
	() => Promise.resolve('foobar')
		.then(() => {
			throw Boom.badRequest('invalid parameters provided');
		}),
);

module.exports.apiMethodsSucceed = apiMethods({
	get: () => Promise.resolve({ data: 'successful get' }),
	post: () => Promise.resolve({ data: 'successful post' }),
});

module.exports.apiMethodsFail = apiMethods({
	post: () => Promise.resolve({ data: 'successful post' }),
});

module.exports.apiMethodsWithOptionsSucceed = apiMethodsWithOptions(apiOptions)({
	get: () => Promise.resolve({ data: 'successful get' }),
	post: () => Promise.resolve({ data: 'successful post' }),
});

module.exports.apiMethodsWithOptionsFail = apiMethodsWithOptions(apiOptionsWithoutGet)({
	post: () => Promise.resolve({ data: 'successful post' }),
});

