// Create a new isolate limited to 128MB
let ivm = require('isolated-vm');
let isolate = new ivm.Isolate({ memoryLimit: 128 });

// Create a new context within this isolate. Each context has its own copy of all the builtin
// Objects. So for instance if one context does Object.prototype.foo = 1 this would not affect any
// other contexts.
let context = isolate.createContextSync();

// Get a Reference{} to the global object within the context.
let jail = context.global;

// This make the global object available in the context as `global`. We use `derefInto()` here
// because otherwise `global` would actually be a Reference{} object in the new isolate.
jail.setSync('global', jail.derefInto());

// The entire ivm module is transferable! We transfer the module to the new isolate so that we
// have access to the library from within the isolate.
jail.setSync('_ivm', ivm);

// We will create a basic `log` function for the new isolate to use.
jail.setSync('_log', new ivm.Reference(function(...args) {
	console.log(...args);
}));

// This will bootstrap the context. Prependeng 'new ' to a function is just a convenient way to
// convert that function into a self-executing closure that is still syntax highlighted by
// editors. It drives strict mode and linters crazy though.
let bootstrap = isolate.compileScriptSync('new '+ function() {
	// Grab a reference to the ivm module and delete it from global scope. Now this closure is the
	// only place in the context with a reference to the module. The `ivm` module is very powerful
	// so you should not put it in the hands of untrusted code.
	let ivm = _ivm;
	delete _ivm;

	// Now we create the other half of the `log` function in this isolate. We'll just take every
	// argument, create an external copy of it and pass it along to the log function above.
	let log = _log;
	delete _log;
	global.log = function(...args) {
		// We use `copyInto()` here so that on the other side we don't have to call `copy()`. It
		// doesn't make a difference who requests the copy, the result is the same.
		// `applyIgnored` calls `log` asynchronously but doesn't return a promise-- it ignores the
		// return value or thrown exception from `log`.
		log.applyIgnored(undefined, args.map(arg => new ivm.ExternalCopy(arg).copyInto()));
	};
});

// Now we can execute the script we just compiled:
bootstrap.runSync(context);

// And let's test it out:
isolate.compileScriptSync('log("hello world")').runSync(context);
// > hello world

// Let's see what happens when we try to blow the isolate's memory
let hostile = isolate.compileScriptSync('new '+ function() {
	let storage = [];
	let twoMegabytes = 1024 * 1024 * 2;
	while (true) {
		let array = new Uint8Array(twoMegabytes);
		for (let ii = 0; ii < twoMegabytes; ii += 4096) {
			array[ii] = 1; // we have to put something in the array to flush to real memory
		}
		storage.push(array);
		log('I\'ve wasted '+ (storage.length * 2)+ 'MB');
	}
});

// Using the async version of `run` so that calls to `log` will get to the main node isolate
hostile.run(context).catch(err => console.error(err));
hostile.run(context).catch(err => console.error(err));
hostile.run(context).catch(err => console.error(err));
hostile.run(context).catch(err => console.error(err));
hostile.run(context).catch(err => console.error(err));
// I've wasted 2MB
// I've wasted 4MB
// ...
// I've wasted 122MB
// I've wasted 124MB
// RangeError: Array buffer allocation failed
