# nice-lambda

A nice way to make AWS Lambda handlers

## wrapper methods

### lambda(fn)

Returns an event handler function for use with AWS Lambda. The `fn` function
provided is the handler implementation written in the promise-based style.
`fn` takes the `event` and `context` as its first two arguments, and is
expected to return a promise whose resolved value will be passed as the
successful result of the lambda callback. Any error that is thrown within
the promise or chain of promises will be caught and returned as the error
result of the Lambda callback. If function throws an error outside of the
promise chain, it will also be caught and handled. This wrapper will also
prevent Lambda from waiting for the event loop to empty post-callback,
allowing handlers to maintain frozen database connection pools for quicker
responses.

#### Example:

```
const { lambda } = require('nice-lambda');
const Promise = require('bluebird');
module.exports.handler = lambda(event =>
	Promise.resolve()
		.then(() => {
			console.log(`Lambda event: ${JSON.stringify(event)}`);
		})
		.delay(3000)
		.then(() => {
			console.log('Waited 3 seconds');
		}));
```

### api(fn)

Similar to `lambdaPromise` but converts everything into API Gateway responses.
If a data response contains a `statusCode` property, the API response will use
it as the status code and use `data.body` as the API response body; otherwise
the status code will default to 200 and the entire data response will be used
as the API response body. If an error is an instance of Boom, the API response
will use its status code and error message; otherwise the status code will
default to 500 and a generic server error message will be used. If the body
(`data` or `data.body`, depending) is a string, it will be returned as-is;
otherwise it will be JSON stringified before return.

#### Examples:

```
const { api } = require('nice-lambda');
const { User } = require('./model');
module.exports.handler = api(event =>
	User.findById(event.pathParameters.userId)
		.then(user => ({ data: user })));
```

```
const { api } = require('nice-lambda');
const Boom = require('boom');
module.exports.handler = api(() => {
	throw Boom.forbidden('Special permission required');
});
```

### postFormUrlEncoded(fn)

Preprocesses an `event.body64` base64-encoded form-url-encoded input into an
`event.body` object before running `fn`. Returns the raw response from `fn`.

### postRaw(fn)

Preprocesses an `event.body64` base64-encoded raw post input into an
`event.body` object before running `fn`. Returns the raw response from `fn`.

### apiMethods(methodHash)

Similar to `api` but creates a multi-purpose Lambda which can handle the
specified HTTP methods. `methodHash` should be an object in which the keys are
lowercase HTTP method verbs (e.g., "get") and their values are promise-generating
functions like the ones you would pass to `api`.

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

The above documentation is incomplete at this time, but further information can
be found by examining the code and tests.
