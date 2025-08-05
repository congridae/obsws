export async function fetchProtocol(): Promise<ProtocolDefinition> {
	try {
		await Deno.stat("scripts/protocol.json");
	} catch {
		console.log("downloading protocol definition");
		const resp = await fetch(
			"https://github.com/obsproject/obs-websocket/raw/refs/heads/master/docs/generated/protocol.json",
		);
		const data = await resp.text();
		await Deno.writeTextFile(
			"scripts/protocol.json",
			JSON.stringify(JSON.parse(data)), // minify
		);
		return JSON.parse(data);
	}
	const data = await Deno.readTextFile("scripts/protocol.json");
	return JSON.parse(data);
}

export type ProtocolDefinition = {
	enums: EnumDefinition[];
	requests: RequestDefinition[];
	events: EventDefinition[];
};

export type EnumDefinition = {
	enumType: string;
	enumIdentifier: {
		description: string;
		enumIdentifier: string;
		rpcVersion: string;
		deprecated: boolean;
		initialVersion: string;
		enumValue: number;
	}[];
};

export type RequestDefinition = {
	description: string;
	requestType: string;
	complexity: number;
	rpcVersion: string;
	deprecated: boolean;
	initialVersion: string;
	category: string;
	requestFields: {
		valueName: string;
		valueType: ValueType;
		valueDescription: string;
		valueRestrictions?: string;
		valueOptional: boolean;
		valueOptionalBehavior?: string;
	}[];
	responseFields: {
		valueName: string;
		valueType: ValueType;
		valueDescription: string;
	}[];
};

export type EventDefinition = {
	description: string;
	eventType: string;
	eventSubscription: string;
	complexity: number;
	rpcVersion: string;
	depreciated: boolean;
	initialVersion: string;
	category: string;
	dataFields: {
		valueName: string;
		valueType: ValueType;
		valueDescription: string;
	}[];
};

export type ValueType =
	| "Any"
	| "Array<Object>"
	| "Array<String>"
	| "Boolean"
	| "Number"
	| "Object"
	| "String";

export function translateValueType(valueType: ValueType): string {
	switch (valueType) {
		case "Any":
			return "unknown";
		case "Array<Object>":
			return "object[]";
		case "Array<String>":
			return "string[]";
		case "Boolean":
			return "boolean";
		case "Number":
			return "number";
		case "Object":
			return "object";
		case "String":
			return "string";
	}
}

export function humanToPascal(text: string): string {
	return text.split(" ").map(capitalizeFirst).join("");
}

export function capitalizeFirst(text: string): string {
	return text[0].toUpperCase() + text.slice(1);
}

export function humanToCamel(text: string): string {
	return uncapitalizeFirst(humanToPascal(text)); // lmao
}

export function uncapitalizeFirst(text: string): string {
	return text[0].toLowerCase() + text.slice(1);
}

export function pascalToKebab(text: string): string {
	let out = "";
	for (const char of text) {
		if (char.toUpperCase() === char) {
			out += "-";
			out += char.toLowerCase();
		} else {
			out += char;
		}
	}
	return out.slice(1);
}

export async function writeAndFormat(file: string, text: string) {
	const outfile = `${import.meta.dirname}/../src/${file}`;
	await Deno.writeTextFile(outfile, `${text}`);
	await new Deno.Command("deno", {
		args: ["fmt", outfile],
	}).output();
}
