#!/usr/bin/env -S deno run -A

// generates the wrapper stubs in src/client.ts

import { uncapitalizeFirst } from "./common.ts";
import { getEvents } from "./events.ts";
import { getRequests } from "./requests.ts";

const events = getEvents();
const requests = getRequests();

const categories = [
	...new Set([
		...events.map((event) => event.category),
		...requests.map((request) => request.category),
	]),
];

for (const pascal of categories) {
	const camel = uncapitalizeFirst(pascal);
	console.log(`  private _${camel}?: Obs${pascal};
  get ${camel}(): Obs${pascal} {
    if (this._${camel}) return this._${camel};
    return this._${camel} = new Obs${pascal}(this);
  }\n`);
}
