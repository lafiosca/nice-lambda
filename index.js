'use strict';

const Promise = require('bluebird');
const Boom = require('boom');
const _ = require('lodash');
const { invokeEvent } = require('nice-invoke-lambda');

const handler = (preprocessor, dataHandler, errorHandler) =>
	fn =>
		(event, context, callback) => {
			if (event.warmupOnly === true) {
				console.log('Warmup only');
				callback(null, null);
				return;
			}
			try {
				Promise.resolve([event, context])
					.spread(preprocessor)
					.spread(fn)
					.then(data => dataHandler(data, callback, context))
					.catch(error => errorHandler(error, callback, context));
			} catch (error) {
				errorHandler(error, callback, context);
			}
		};

const preprocessorPassthrough = (event, context) => [event, context];
const dataHandlerPassthrough = (data, callback) => callback(null, data);
const errorHandlerPassthrough = (error, callback) => callback(error);

const preprocessorBodyJson = (event, context) => {
	try {
		if (event.body) {
			event.body = JSON.parse(event.body);
		}
	} catch (error) {
		console.error(`Failed to parse event.body JSON: '${event.body}'`);
		throw Boom.badImplementation('Invalid body JSON');
	}
	return [event, context];
};

const decodeEventBody64 = (event) => {
	if (!event.body64) {
		throw Boom.badImplementation('No base64-encoded body found');
	}

	if (event.body) {
		throw Boom.badImplementation('Event already contains body in addition to body64');
	}

	try {
		return Buffer.from(event.body64, 'base64').toString();
	} catch (error) {
		console.error(`Failed to decode event.body64: '${event.body64}'`);
		throw Boom.badImplementation('Failed to decode base64-encoded body');
	}
};

const preprocessorBody64 = (event, context) => {
	event.body = decodeEventBody64(event);
	return [event, context];
};

const preprocessorBody64FormUrlEncoded = (event, context) => {
	const body = decodeEventBody64(event);

	event.body = {};

	const pairs = body.split('&');

	pairs.forEach((pair) => {
		try {
			const splitPair = pair.split('=');
			if (splitPair.length !== 2) {
				throw new Error(`Invalid pair length ${splitPair.length}`);
			}
			const key = decodeURIComponent(splitPair[0].replace(/\+/g, ' '));
			const value = decodeURIComponent(splitPair[1].replace(/\+/g, ' '));
			event.body[key] = value;
		} catch (error) {
			console.error(`Failed to parse base64-decoded event.body64 '${body}' on pair '${pair}'`);
			throw Boom.badRequest('Failed to parse form-url-encoded body');
		}
	});

	return [event, context];
};

const dataHandlerApiWithOptions = (options) => {
	const dataHeaders = options.dataHeaders || options.headers || {};
	return (data, callback) => {
		let response;

		if (_.isPlainObject(data) && _.has(data, 'statusCode')) {
			if (!_.isNumber(data.statusCode)) {
				throw Boom.badImplementation('Data handler returned invalid status code');
			}
			response = {
				statusCode: data.statusCode,
				body: _.get(data, 'body', ''),
				headers: _.get(data, 'headers', dataHeaders),
			};
		} else {
			response = {
				statusCode: 200,
				body: data,
				headers: dataHeaders,
			};
		}

		if (typeof response.body !== 'string') {
			response.body = JSON.stringify(response.body);
		}

		callback(null, response);
	};
};

const errorHandlerApiWithOptions = (options) => {
	const errorHeaders = options.errorHeaders || options.headers || {};

	return (error, callback) => {
		if (options.errorPreHandler) {
			options.errorPreHandler(error);
		}

		const boom = Boom.isBoom(error)
			? error
			: Boom.badImplementation(_.get(
				error,
				'message',
				'Unexpected internal server error'
			));

		const response = {
			statusCode: boom.output.statusCode,
			body: JSON.stringify(boom.output.payload),
			headers: errorHeaders,
		};

		callback(null, response);
	};
};

const lambda = handler(
	preprocessorPassthrough,
	dataHandlerPassthrough,
	errorHandlerPassthrough
);

const apiWithOptions = options => handler(
	preprocessorBodyJson,
	dataHandlerApiWithOptions(options),
	errorHandlerApiWithOptions(options)
);

const api = apiWithOptions({});

const apiMethodsWithOptions = options =>
	(mapping) => {
		const mapper = (event, context) => {
			if (!event.httpMethod) {
				throw Boom.badRequest('Request event did not contain httpMethod');
			}
			const lowerMethod = _.toLower(event.httpMethod);
			if (!mapping[lowerMethod]) {
				throw Boom.badRequest(`Method ${event.httpMethod} is not supported`);
			}
			return mapping[lowerMethod](event, context);
		};
		return handler(
			preprocessorBodyJson,
			dataHandlerApiWithOptions(options),
			errorHandlerApiWithOptions(options)
		)(mapper);
	};

const apiMethods = apiMethodsWithOptions({});

const postRaw = handler(
	preprocessorBody64,
	dataHandlerPassthrough,
	errorHandlerPassthrough
);

const postFormUrlEncoded = handler(
	preprocessorBody64FormUrlEncoded,
	dataHandlerPassthrough,
	errorHandlerPassthrough
);

const warmer = lambdasToWarm => lambda(() =>
	Promise.all(lambdasToWarm.map((lambdaToWarm) => {
		console.log(`Warming up ${lambdaToWarm}`);
		return invokeEvent(lambdaToWarm, { warmupOnly: true })
			.catch((error) => {
				console.error(`Warmup of ${lambdaToWarm} failed: ${error}`);
			});
	}))
		.then(() => null));

module.exports = {
	handler,
	lambda,
	api,
	apiWithOptions,
	apiMethods,
	apiMethodsWithOptions,
	postRaw,
	postFormUrlEncoded,
	warmer,
};
