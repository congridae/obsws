export async function dotenv() {
	let text;
	try {
		text = await Deno.readTextFile(`${import.meta.dirname}/../.env`);
	} catch {
		return;
	}
	const vars = text.split("\n").map((line) => line.split("#")[0]).filter((
		line,
	) => line.includes("=")).map((line) => {
		const idx = line.indexOf("=");
		return [line.slice(0, idx), line.slice(idx + 1)];
	});
	for (const [name, value] of vars) {
		Deno.env.set(name, value);
	}
}
