# obsws
Type-safe zero-dependency OBS websocket client for TypeScript

# usage
```typescript
import { ObsWs } from "@conger/obsws";

const ws = new ObsWs({
	port: 4455,
	password: "password",
	onError: (err) => {
		console.error(err);
	},
});

const currentScene = await ws.scenes.getCurrentProgramScene();
console.log(`current scene: ${currentScene.sceneName}`);
ws.scenes.onCurrentProgramSceneChanged((ev) => {
	console.log(`scene changed to: ${ev.sceneName}`);
});
ws.general.onExitStarted(() => ws.close());
```

# features
- All requests and events typed
- Zero dependencies
- No dropped requests/subscriptions on OBS restart
