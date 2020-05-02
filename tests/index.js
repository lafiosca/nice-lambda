'use strict';

const lodash = require('lodash');
const tests = require('./tests');

lodash.each(tests, (test, name) => {
	test(
		{ hello: 'world', httpMethod: 'GET' },
		{},
		(err, data) => {
			if (err) {
				console.error(`${name} lambda failed:`, err);
			} else {
				console.log(`${name} lambda succeeded:`, data);
			}
			console.log('');
		}
	);
});
