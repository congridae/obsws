import { ObsWs } from "@conger/obsws";
import { dotenv } from "./common.ts";

await dotenv();

const ws = new ObsWs({
	port: parseInt(Deno.env.get("port")!),
	password: Deno.env.get("password"),
	onError: (err) => {
		console.error(err);
	},
});

const currentScene = await ws.scenes.getCurrentProgramScene();
console.log(`current scene: ${currentScene.sceneName}`);
ws.scenes.onCurrentProgramSceneChanged((ev) => {
	console.log(`changed scene to: ${ev.sceneName}`);
});
ws.general.onExitStarted(() => ws.close());
