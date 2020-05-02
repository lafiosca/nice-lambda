# nice-lambda

A nice way to make AWS Lambda functions and call them

## wrapper methods

### lambda(logicHandler: (call: LambdaCall) => Promise<any> | any)

Returns an event handler function for use with AWS Lambda. The `logicHandler` function
provided is the handler implementation and may be async. `logicHandler` receives a single
object argument which contains the Lambda `event` and `context` objects. It is expected
to return or resolve to a value which will be used as the successful result of the Lambda
callback. Any error that is thrown will be caught and returned as the error result of the
Lambda callback instead.

#### Example:

```
const { lambda } = require('nice-lambda');

module.exports.handler = lambda(
	async ({ event }) => {
		console.log(`Lambda event: ${JSON.stringify(event)}`);
		// [... await some data stuff ...]
		return 23;
	},
);
```

### api(logicHandler: (call: LambdaCall) => Promise<any> | any)

Similar to `lambda` but converts everything into API Gateway responses.
If a data response contains a `statusCode` property, the API response will use
it as the status code and use `data.body` as the API response body; otherwise
the status code will default to 200 and the entire data response will be used
as the API response body. If an error is an instance of Boom, the API response
will use its status code and error message; otherwise the status code will
default to 500 and a generic server error message will be used. If the body
(`data` or `data.body`, depending) is a string, it will be returned as-is;
otherwise it will be JSON-stringified before return.

#### Examples:

```
const { api } = require('nice-lambda');
const { User } = require('./model');

module.exports.handler = api(
	async ({ event }) => {
		const user = await User.findById(event.pathParameters.userId);
		const posts = await User.getPosts();
		return { // response in JSON:API format: https://jsonapi.org/
			data: {
				user,
				posts,
			},
			meta: {
				authors: ['Joe Lafiosca'],
			},
		};
	},
);
```

```
const { api } = require('nice-lambda');
const Boom = require('@hapi/boom');

module.exports.handler = api(() => {
	throw Boom.forbidden('Special permission required');
});
```

### postFormUrlEncoded(logicHandler: (call: LambdaCall) => Promise<any> | any)

Preprocesses an `event.body64` base64-encoded form-url-encoded input into an
`event.body` object before running `logicHandler`. Returns the raw response
from `logicHandler`.

### postRaw(logicHandler: (call: LambdaCall) => Promise<any> | any)

Preprocesses an `event.body64` base64-encoded raw post input into an
`event.body` object before running `logicHandler`. Returns the raw response
from `logicHandler`.

### apiMethods(methodMapping: { [key: string]: LogicHandler; })

Similar to `api` but creates a multi-purpose Lambda which can handle the
specified HTTP methods. `methodMapping` should be an object in which the keys
are lowercase HTTP method verbs (e.g., `get`) and their values are logic handlers
like the ones you would pass to `api`.

```
const { apiMethods } = require('nice-lambda');
const {
	getResource,
	updateResource,
	deleteResource,
} = require('./resource');

exports.handler = apiMethods({
	get: getResource,
	post: updateResource,
	delete: deleteResource,
});
```

## documentation note

The above documentation is incomplete, but further information can
be found by examining the code.
