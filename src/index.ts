import awsSdk from 'aws-sdk';
import { Context, Callback } from 'aws-lambda';
import lodash from 'lodash';
import {
	badImplementation,
	badRequest,
	isBoom,
} from '@hapi/boom';

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
export type LogicHandler = (call: LambdaCall) => Promise<any> | any;
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

const lambdaService = new awsSdk.Lambda();

export const invokeRequestResponse = async (lambdaFunction: string, lambdaEvent: any) => {
	const params = {
		FunctionName: lambdaFunction,
		Payload: JSON.stringify(lambdaEvent),
		InvocationType: 'RequestResponse',
	};

	const response = await lambdaService.invoke(params).promise();

	if (response.StatusCode !== 200) {
		// Lambda service failure
		throw new Error(
			`Failed to invoke Lambda function ${lambdaFunction}:\n${JSON.stringify(response, null, 2)}`,
		);
	}

	let payload;

	try {
		payload = JSON.parse(response.Payload as string);
	} catch (error) {
		// Bad JSON payload from Lambda service?
		const errorMessage = error.message || JSON.stringify(error, null, 2);
		throw new Error(
			`Failed to parse Lambda response payload '${response.Payload}':\n${errorMessage}`,
		);
	}

	if (response.FunctionError) {
		if (response.FunctionError === 'Unhandled') {
			/*
			 * 'Unhandled' means that there was an error or uncaught exception
			 * while executing the Lambda function. The content of the error
			 * object stored in the payload is generated by the Lambda service.
			 *
			 * Example of 'Unhandled' error payload:
			 * {
			 *   errorMessage: 'Unexpected token {',
			 *   errorType: 'SyntaxError',
			 *   stackTrace: [
			 *     'Module.load (module.js:343:32)',
			 *     'Function.Module._load (module.js:300:12)',
			 *     'Module.require (module.js:353:17)',
			 *     'require (internal/module.js:12:17)',
			 *   ],
			 * }
			 */
			throw payload;
		}

		if (response.FunctionError === 'Handled') {
			/*
			 * 'Handled' means that the Lambda function executed successfully
			 * but returned an error via the first argument of the handler's
			 * callback. Unfortunately, the Lambda service will always coerce
			 * the error argument to a string (i.e., example #2 below). We can
			 * however return JSON error strings for more complex content.
			 *
			 * Example #1 of 'Handled' error payload:
			 * { errorMessage: 'Failed to add numbers' }
			 *
			 * Example #2 of 'Handled' error payload:
			 * { errorMessage: '[object Object]' }
			 */

			let error;

			try {
				// Try to deserialize the error string, just in case
				error = JSON.parse(payload.errorMessage);
			} catch (jsonError) {
				// It's not JSON, so use the string as-is
				error = payload.errorMessage;
			}

			throw error;
		}

		// This should never happen
		throw new Error(`Unrecognized Lambda response FunctionError value '${response.FunctionError}'`);
	}

	// Successful response from Lambda
	return payload;
};

export const invokeEvent = async (lambdaFunction: string, lambdaEvent: any) => {
	const params = {
		FunctionName: lambdaFunction,
		Payload: JSON.stringify(lambdaEvent),
		InvocationType: 'Event',
	};

	const response = await lambdaService.invoke(params).promise();

	if (response.StatusCode !== 202) {
		// Lambda service failure
		throw new Error(
			`Failed to invoke Lambda function ${lambdaFunction}:\n${JSON.stringify(response, null, 2)}`,
		);
	}

	return true;
};

export const buildHandlerFactory = (
	preprocessor: Preprocessor,
	dataHandler: DataHandler,
	errorHandler: ErrorHandler,
): LambdaHandlerFactory => (
	(logicHandler: LogicHandler) => (
		(event: LambdaEvent, context: Context, callback: Callback) => {
			if (event.warmupOnly === true) {
				console.log('Warmup only');
				callback(null, null);
				return;
			}
			const call: LambdaCall = { event, context, callback };
			Promise.resolve(call)
				.then(preprocessor)
				.then(logicHandler)
				.then((data) => dataHandler({ ...call, data }))
				.catch((error) => errorHandler({ ...call, error }));
		}
	)
);

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
		if (lodash.isPlainObject(call.data) && lodash.has(call.data, 'statusCode')) {
			if (!lodash.isNumber(call.data.statusCode)) {
				throw badImplementation('Data handler returned invalid status code');
			}
			response = {
				statusCode: call.data.statusCode,
				body: lodash.get(call.data, 'body', ''),
				headers: lodash.get(call.data, 'headers', dataHeaders),
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
			: badImplementation(lodash.get(
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

export const apiMethodsWithOptions = (options: ApiOptions) => (
	(mapping: MethodMapping) => {
		const mapper = (call: LambdaCall) => {
			if (!call.event.httpMethod) {
				throw badImplementation('Request event did not contain httpMethod');
			}
			const lowerMethod = lodash.toLower(call.event.httpMethod);
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
	}
);

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

const createLambdaWarmerLogicHandler = async (lambdaToWarm: string) => {
	console.log(`Warming up ${lambdaToWarm}`);
	try {
		await invokeEvent(lambdaToWarm, { warmupOnly: true });
	} catch (error) {
		console.error(`Warmup of ${lambdaToWarm} failed: ${error}`);
	}
};

export const lambdaWarmer = (lambdasToWarm: string[]) => lambda(
	async () => {
		await Promise.all(lambdasToWarm.map(createLambdaWarmerLogicHandler));
	},
);
