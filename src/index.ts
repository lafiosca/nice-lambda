import _ from 'lodash';
import { invokeEvent } from 'nice-invoke-lambda';
import { Context, Callback } from 'aws-lambda';
import { badImplementation, badRequest, isBoom } from 'boom';

export interface LambdaEvent {
	[key: string]: any;
	warmupOnly?: boolean;
}

export interface LambdaCall {
	event: LambdaEvent;
	context: Context;
	callback: Callback<any>;
}

export interface LambdaCallWithData extends LambdaCall {
	data: any;
}

export interface LambdaCallWithError extends LambdaCall {
	error: any;
}

export type Preprocessor = (call: LambdaCall) => Promise<LambdaCall> | LambdaCall;
export type LogicHandler = (call: LambdaCall) => any;
export type DataHandler = (call: LambdaCallWithData) => void;
export type ErrorHandler = (call: LambdaCallWithError) => void;
export type LambdaHandler = (event: LambdaEvent, context: Context, callback: Callback<any>) => void;
export type LambdaHandlerFactory = (logicHandler: LogicHandler) => LambdaHandler;

export interface Headers {
	[key: string]: string;
}

export interface ApiOptions {
	headers?: Headers;
	dataHeaders?: Headers;
	errorHeaders?: Headers;
	errorPreHandler?: (error: any) => void;
}

export interface MethodMapping {
	[key: string]: LogicHandler;
}

export const buildHandlerFactory = (
	preprocessor: Preprocessor,
	dataHandler: DataHandler,
	errorHandler: ErrorHandler,
): LambdaHandlerFactory =>
	(logicHandler: LogicHandler) =>
		(event: LambdaEvent, context: Context, callback: Callback<any>) => {
			if (event.warmupOnly === true) {
				console.log('Warmup only');
				callback(null, null);
				return;
			}
			const call: LambdaCall = { event, context, callback };
			try {
				Promise.resolve(call)
					.then(preprocessor)
					.then(logicHandler)
					.then((data) => dataHandler({ ...call, data }))
					.catch((error) => errorHandler({ ...call, error }));
			} catch (error) {
				errorHandler({ ...call, error });
			}
		};

const preprocessorPassthrough: Preprocessor = (call: LambdaCall) => call;

const dataHandlerPassthrough: DataHandler = (call: LambdaCallWithData) => {
	call.callback(null, call.data);
};

const errorHandlerPassthrough: ErrorHandler = (call: LambdaCallWithError) => {
	call.callback(call.error);
};

const preprocessorBodyJson: Preprocessor = (call: LambdaCall) => {
	try {
		if (call.event.body) {
			return {
				...call,
				event: {
					...call.event,
					body: JSON.parse(call.event.body),
				},
			};
		}
	} catch (error) {
		console.error(`Failed to parse event.body JSON: '${call.event.body}'`);
		throw badImplementation('Invalid body JSON');
	}
	return call;
};

const decodeEventBody64 = (event: LambdaEvent) => {
	if (!event.body64) {
		throw badImplementation('No base64-encoded body found');
	}

	if (event.body) {
		throw badImplementation('Event already contains body in addition to body64');
	}

	try {
		return Buffer.from(event.body64, 'base64').toString();
	} catch (error) {
		console.error(`Failed to decode event.body64: '${event.body64}'`);
		throw badImplementation('Failed to decode base64-encoded body');
	}
};

const preprocessorBody64: Preprocessor = (call: LambdaCall) => ({
	...call,
	event: {
		...call.event,
		body: decodeEventBody64(call.event),
	},
});

const preprocessorBody64FormUrlEncoded: Preprocessor = (call: LambdaCall) => {
	const decodedBody = decodeEventBody64(call.event);
	const body: { [key: string]: string } = {};
	const pairs = decodedBody.split('&');
	pairs.forEach((pair) => {
		try {
			const splitPair = pair.split('=');
			if (splitPair.length !== 2) {
				throw new Error(`Invalid pair length ${splitPair.length}`);
			}
			const key = decodeURIComponent(splitPair[0].replace(/\+/g, ' '));
			const value = decodeURIComponent(splitPair[1].replace(/\+/g, ' '));
			body[key] = value;
		} catch (error) {
			console.error(`Failed to parse base64-decoded event.body64 '${decodedBody}' on pair '${pair}'`);
			throw badRequest('Failed to parse form-url-encoded body');
		}
	});

	return {
		...call,
		event: {
			...call.event,
			body,
		},
	};
};

const dataHandlerApiWithOptions = (options: ApiOptions): DataHandler => {
	const dataHeaders = options.dataHeaders || options.headers || {};
	return (call: LambdaCallWithData) => {
		let response;
		if (_.isPlainObject(call.data) && _.has(call.data, 'statusCode')) {
			if (!_.isNumber(call.data.statusCode)) {
				throw badImplementation('Data handler returned invalid status code');
			}
			response = {
				statusCode: call.data.statusCode,
				body: _.get(call.data, 'body', ''),
				headers: _.get(call.data, 'headers', dataHeaders),
			};
		} else {
			response = {
				statusCode: 200,
				body: call.data,
				headers: dataHeaders,
			};
		}

		if (typeof response.body !== 'string') {
			response.body = JSON.stringify(response.body);
		}

		call.callback(null, response);
	};
};

const errorHandlerApiWithOptions = (options: ApiOptions): ErrorHandler => {
	const errorHeaders = options.errorHeaders || options.headers || {};
	return (call: LambdaCallWithError) => {
		if (options.errorPreHandler) {
			options.errorPreHandler(call.error);
		}

		const boom = isBoom(call.error)
			? call.error
			: badImplementation(_.get(
				call.error,
				'message',
				'Unexpected internal server error',
			));

		const response = {
			statusCode: boom.output.statusCode,
			body: JSON.stringify(boom.output.payload),
			headers: errorHeaders,
		};

		call.callback(null, response);
	};
};

export const lambda = buildHandlerFactory(
	preprocessorPassthrough,
	dataHandlerPassthrough,
	errorHandlerPassthrough,
);

export const apiWithOptions = (options: ApiOptions) => buildHandlerFactory(
	preprocessorBodyJson,
	dataHandlerApiWithOptions(options),
	errorHandlerApiWithOptions(options),
);

export const api = apiWithOptions({});

export const apiMethodsWithOptions = (options: ApiOptions) =>
	(mapping: MethodMapping) => {
		const mapper = (call: LambdaCall) => {
			if (!call.event.httpMethod) {
				throw badImplementation('Request event did not contain httpMethod');
			}
			const lowerMethod = _.toLower(call.event.httpMethod);
			if (!mapping[lowerMethod]) {
				throw badRequest(`This resource does not support the '${call.event.httpMethod}' method`);
			}
			return mapping[lowerMethod](call);
		};
		return buildHandlerFactory(
			preprocessorBodyJson,
			dataHandlerApiWithOptions(options),
			errorHandlerApiWithOptions(options),
		)(mapper);
	};

export const apiMethods = apiMethodsWithOptions({});

export const postRaw = buildHandlerFactory(
	preprocessorBody64,
	dataHandlerPassthrough,
	errorHandlerPassthrough,
);

export const postFormUrlEncoded = buildHandlerFactory(
	preprocessorBody64FormUrlEncoded,
	dataHandlerPassthrough,
	errorHandlerPassthrough,
);

export const warmer = (lambdasToWarm: string[]) => lambda(() =>
	Promise.all(lambdasToWarm.map((lambdaToWarm) => {
		console.log(`Warming up ${lambdaToWarm}`);
		return invokeEvent(lambdaToWarm, { warmupOnly: true })
			.catch((error) => {
				console.error(`Warmup of ${lambdaToWarm} failed: ${error}`);
			});
	}))
		.then(() => null));
